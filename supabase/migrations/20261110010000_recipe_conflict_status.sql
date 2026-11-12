-- Use a non-retryable HTTP conflict instead of a serialization failure.
-- PostgREST may retry SQLSTATE 40001 indefinitely. Preserve the original grants.
begin;

create or replace function public.save_recipes(p_recipes jsonb)
returns setof public.recipes
language plpgsql security invoker set search_path = '' as $$
declare
    item jsonb;
    saved public.recipes;
    target_id text;
begin
    if jsonb_typeof(p_recipes) is distinct from 'array' then
        raise exception 'Expected an array of recipes' using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_array_elements(p_recipes) as entry
        group by entry -> 'document' ->> 'recipeId' having count(*) > 1
    ) then
        raise exception 'Duplicate recipe IDs' using errcode = '22023';
    end if;
    -- Consistent locking order for concurrent uploads.
    for item in select value from jsonb_array_elements(p_recipes)
                order by value -> 'document' ->> 'recipeId'
    loop
        target_id := item -> 'document' ->> 'recipeId';
        if item ->> 'expected_revision' is null then
            insert into public.recipes (recipe_id, document)
            values (target_id, item -> 'document')
            on conflict (recipe_id) do nothing returning * into saved;
            if found then
                return next saved;
                continue;
            end if;
        end if;
        select * into saved from public.recipes
        where recipe_id = target_id for update;
        if not found then
            raise exception 'Recipe was removed: %', target_id using errcode = 'PT409';
        end if;
        if saved.document = item -> 'document' then
            return next saved;
            continue;
        end if;
        if saved.revision is distinct from (item ->> 'expected_revision')::bigint then
            raise exception 'Recipe changed: %', target_id using errcode = 'PT409';
        end if;
        update public.recipes set document = item -> 'document'
        where recipe_id = target_id returning * into saved;
        return next saved;
    end loop;
end;
$$;

commit;
