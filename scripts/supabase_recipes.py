"""Upload/download validated recipe JSONs using Supabase's private Data API."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from compile_recipe import compile_recipe
from recipe_types import Recipe


ROOT = Path(__file__).resolve().parents[1]
STATE_NAME = '.supabase-revisions.json'


class RecipeRow(TypedDict):
    recipe_id: str
    document: Recipe
    revision: int


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: object, code: int, msg: str,
                         headers: object, newurl: str) -> None:
        # Never forward the secret key to a redirected host.
        return None


class RecipeStore:
    def __init__(self, url: str, key: str) -> None:
        parsed = urlsplit(url)
        local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
        if (not parsed.hostname or parsed.username or parsed.password or parsed.query
                or parsed.fragment or parsed.path not in ('', '/')
                or (parsed.scheme != 'https' and not (local and parsed.scheme == 'http'))):
            raise ValueError('SUPABASE_URL must be an HTTPS project origin (HTTP allowed for localhost).')
        if not key or key == 'sb_secret_replace_me':
            raise ValueError('Set SUPABASE_SECRET_KEY to the project secret key.')
        self.url = url.rstrip('/')
        self.key = key

    @classmethod
    def from_env(cls) -> RecipeStore:
        url = os.environ.get('SUPABASE_URL', '')
        key = os.environ.get('SUPABASE_SECRET_KEY', '')
        if not url or not key:
            raise ValueError('Set SUPABASE_URL and SUPABASE_SECRET_KEY; see .env.example and README.')
        return cls(url, key)

    def request(self, path: str, payload: object = None) -> object:
        headers = {'apikey': self.key, 'Accept': 'application/json'}
        # Legacy service_role JWTs also need the bearer header. New secret keys do not.
        if not self.key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + self.key
        data = None
        if payload is not None:
            data = json.dumps(payload, allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        request = Request(self.url + '/rest/v1/' + path, data=data, headers=headers)
        try:
            with build_opener(NoRedirect()).open(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read())
            except (ValueError, UnicodeError):
                detail = {}
            finally:
                exc.close()
            if isinstance(detail, dict) and detail.get('code') in ('PT409', '40001'):
                raise ValueError('Upload conflict: remote recipes changed. Download into a separate '
                                 'directory and reconcile before retrying; no recipes were saved.') from None
            # Do not print server bodies, request headers, or credentials.
            raise ValueError(f'Supabase request failed (HTTP {exc.code}). Check project status, '
                             'credentials, and that the recipe migration has been applied.') from None
        except URLError:
            raise ValueError('Cannot reach Supabase. Check the network and whether the Free project '
                             'needs to be resumed in the dashboard.') from None

    def rows(self) -> list[RecipeRow]:
        result: list[RecipeRow] = []
        after = ''
        while True:
            query = {'select': 'recipe_id,document,revision', 'order': 'recipe_id.asc', 'limit': '200'}
            if after:
                query['recipe_id'] = 'gt.' + after
            batch = validate_rows(self.request('recipes?' + urlencode(query)))
            if not batch:
                break
            if any(row['recipe_id'] <= after for row in batch):
                raise ValueError('Supabase returned recipes out of order.')
            result.extend(batch)
            after = batch[-1]['recipe_id']
        if len({row['recipe_id'] for row in result}) != len(result):
            raise ValueError('Supabase returned duplicate recipes.')
        return result


def validate_rows(value: object) -> list[RecipeRow]:
    if not isinstance(value, list):
        raise ValueError('Expected a list of stored recipes.')
    for row in value:
        if not isinstance(row, dict) or 'document' not in row:
            raise ValueError('Malformed stored recipe.')
        graph = compile_recipe(row['document'])
        if row.get('recipe_id') != graph['recipeId']:
            raise ValueError('Stored recipe ID does not match its document.')
        if type(row.get('revision')) is not int or row['revision'] < 1:
            raise ValueError('Invalid stored recipe revision.')
    return cast(list[RecipeRow], value)


def local_recipes(directory: Path) -> list[Recipe]:
    recipes: list[Recipe] = []
    seen: set[str] = set()
    for path in sorted(directory.glob('*.recipe.json')):
        document = json.loads(path.read_text(encoding='utf-8'))
        graph = compile_recipe(document)
        if graph['recipeId'] in seen:
            raise ValueError('Duplicate recipe ID: ' + graph['recipeId'])
        seen.add(graph['recipeId'])
        recipes.append(cast(Recipe, document))
    if not recipes:
        raise ValueError(f'No recipe JSON files in {directory}.')
    return recipes


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     prefix='.' + path.name, delete=False) as handle:
        temp = Path(handle.name)
        try:
            json.dump(value, handle, indent=2, ensure_ascii=False, allow_nan=False)
            handle.write('\n')
            handle.close()
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def revisions(directory: Path, url: str) -> dict[str, int]:
    path = directory / STATE_NAME
    if not path.exists():
        return {}
    state = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(state, dict) or state.get('url') != url:
        raise ValueError('Recipe revision file belongs to another project; use a separate directory.')
    values = state.get('revisions')
    if not isinstance(values, dict) or any(type(v) is not int or v < 1 for v in values.values()):
        raise ValueError('Invalid recipe revision file; download into a separate directory to recover.')
    return cast(dict[str, int], values)


def upload(store: RecipeStore, directory: Path, documents: list[Recipe]) -> int:
    known = revisions(directory, store.url)
    payload = [{'document': doc, 'expected_revision': known.get(doc['recipeId'])} for doc in documents]
    saved = validate_rows(store.request('rpc/save_recipes', {'p_recipes': payload}))
    if {row['recipe_id'] for row in saved} != {doc['recipeId'] for doc in documents}:
        raise ValueError('Incomplete upload response; retry to reconcile stored revisions.')
    known.update({row['recipe_id']: row['revision'] for row in saved})
    atomic_json(directory / STATE_NAME, {'url': store.url, 'revisions': known})
    return len(saved)


def download(store: RecipeStore, directory: Path, overwrite: bool = False) -> int:
    rows = store.rows()  # Validate the entire result before touching local files.
    known = revisions(directory, store.url)
    for row in rows:
        path = directory / (row['recipe_id'] + '.recipe.json')
        if path.exists() and not overwrite:
            try:
                same = json.loads(path.read_text(encoding='utf-8')) == row['document']
            except ValueError:
                same = False
            if not same:
                raise ValueError(f'Refusing to overwrite {path}; choose a separate directory or --overwrite.')
    for row in rows:
        atomic_json(directory / (row['recipe_id'] + '.recipe.json'), row['document'])
        known[row['recipe_id']] = row['revision']
    atomic_json(directory / STATE_NAME, {'url': store.url, 'revisions': known})
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    push = commands.add_parser('upload', help='Validate and atomically save local recipe JSONs')
    push.add_argument('--directory', type=Path, default=ROOT / 'recipes')
    push.add_argument('--dry-run', action='store_true', help='Validate locally without credentials or network')
    pull = commands.add_parser('download', help='Download validated recipes; never deletes local files')
    pull.add_argument('--directory', type=Path, default=ROOT / 'tmp/supabase-recipes')
    pull.add_argument('--overwrite', action='store_true', help='Replace differing local recipe documents')
    args = parser.parse_args()
    try:
        if args.command == 'upload':
            documents = local_recipes(args.directory)
            if args.dry_run:
                print(f'Validated {len(documents)} recipes; no network requests made.')
                return
            count = upload(RecipeStore.from_env(), args.directory, documents)
            print(f'Uploaded {count} recipes (identical documents left unchanged).')
        else:
            count = download(RecipeStore.from_env(), args.directory, args.overwrite)
            print(f'Downloaded {count} recipes to {args.directory}.')
    except (ValueError, OSError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
