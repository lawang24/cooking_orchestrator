-- Run after seeding at least one recipe. All test writes are rolled back.
begin;
set local role service_role;
do $$
declare
    doc jsonb;
    changed jsonb;
    result public.recipes;
    role_name text;
begin
    select document into strict doc from public.recipes order by recipe_id limit 1;
    doc := jsonb_set(doc, '{recipeId}', '"storage-test-a"');
    assert not exists (select 1 from public.recipes where recipe_id in ('storage-test-a', 'storage-test-0')),
        'Test IDs already exist; choose unused IDs';
    select * into strict result from public.save_recipes(jsonb_build_array(
        jsonb_build_object('document', doc, 'expected_revision', null)));
    assert result.document = doc and result.revision = 1, 'Insert round trip failed';

    select * into strict result from public.save_recipes(jsonb_build_array(
        jsonb_build_object('document', doc, 'expected_revision', null)));
    assert result.revision = 1, 'Identical retry changed revision';

    changed := jsonb_set(doc, '{name}', '"Updated recipe test"');
    select * into strict result from public.save_recipes(jsonb_build_array(
        jsonb_build_object('document', changed, 'expected_revision', 1)));
    assert result.document = changed and result.revision = 2, 'Revision update failed';

    begin
        perform public.save_recipes(jsonb_build_array(
            jsonb_build_object('document', jsonb_set(doc, '{recipeId}', '"storage-test-0"'),
                              'expected_revision', null),
            jsonb_build_object('document', doc, 'expected_revision', 1)));
        raise exception 'Expected stale revision conflict';
    exception when sqlstate 'PT409' then
        null;
    end;
    assert not exists (select 1 from public.recipes where recipe_id = 'storage-test-0'),
        'Conflict did not roll back the entire upload';
    assert (select revision = 2 from public.recipes where recipe_id = 'storage-test-a'),
        'Conflict altered existing data';

    begin
        perform public.save_recipes(jsonb_build_array(
            jsonb_build_object('document', doc, 'expected_revision', 2),
            jsonb_build_object('document', doc, 'expected_revision', 2)));
        raise exception 'Expected duplicate ID rejection';
    exception when invalid_parameter_value then
        null;
    end;

    begin
        insert into public.recipes(recipe_id, document)
        values ('storage-test-0', '{"recipeId":null,"schemaVersion":null}');
        raise exception 'Expected invalid document rejection';
    exception when check_violation then
        null;
    end;

    foreach role_name in array array['anon', 'authenticated'] loop
        assert not has_table_privilege(role_name, 'public.recipes', 'SELECT,INSERT,UPDATE,DELETE'),
            'Untrusted role has table access';
        assert not has_function_privilege(role_name, 'public.save_recipes(jsonb)', 'EXECUTE'),
            'Untrusted role has upload access';
    end loop;
    assert (select relrowsecurity from pg_class where oid = 'public.recipes'::regclass),
        'RLS is disabled';
end;
$$;
rollback;
