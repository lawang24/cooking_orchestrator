begin;

create table public.recipes (
    recipe_id text primary key check (recipe_id ~ '^[a-z][a-z0-9_-]*$'),
    document jsonb not null check ((
        jsonb_typeof(document) = 'object'
        and document ? 'recipeId'
        and document ->> 'recipeId' = recipe_id
        and document ? 'schemaVersion'
        and document ->> 'schemaVersion' = '1.0'
    ) is true),
    revision bigint not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.recipes enable row level security;
revoke all on table public.recipes from public, anon, authenticated, service_role;
grant select, insert, update on table public.recipes to service_role;

-- Database-maintained revisions also protect against edits made in the dashboard.
create function public.bump_recipe_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
    new.recipe_id := old.recipe_id;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
    new.updated_at := now();
    return new;
end;
$$;
revoke all on function public.bump_recipe_revision() from public, anon, authenticated;
create trigger recipe_revision before update on public.recipes
for each row execute function public.bump_recipe_revision();

-- One transaction for a whole upload. An outdated revision rolls back the batch.
-- Identical documents are a no-op, including retries after a lost response.
create function public.save_recipes(p_recipes jsonb)
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
            raise exception 'Recipe was removed: %', target_id using errcode = '40001';
        end if;
        if saved.document = item -> 'document' then
            return next saved;
            continue;
        end if;
        if saved.revision is distinct from (item ->> 'expected_revision')::bigint then
            raise exception 'Recipe changed: %', target_id using errcode = '40001';
        end if;
        update public.recipes set document = item -> 'document'
        where recipe_id = target_id returning * into saved;
        return next saved;
    end loop;
end;
$$;
revoke all on function public.save_recipes(jsonb) from public, anon, authenticated;
grant execute on function public.save_recipes(jsonb) to service_role;

commit;
