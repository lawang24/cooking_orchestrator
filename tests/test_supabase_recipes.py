import copy
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from supabase_recipes import (
    RecipeStore, STATE_NAME, download, local_recipes, revisions, upload, validate_rows,
)
from serve_recipe_graphs import build_site
from compile_recipe import compile_recipe
from recipe_viewer_data import action_order


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads((ROOT / 'recipes/scrambled-eggs.recipe.json').read_text())
        self.row = {'recipe_id': self.document['recipeId'], 'document': self.document, 'revision': 1}
        self.store = RecipeStore('https://example.supabase.co', 'sb_secret_test')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def test_all_repository_recipes_validate(self):
        self.assertEqual(len(local_recipes(ROOT / 'recipes')), len(list((ROOT / 'recipes').glob('*.recipe.json'))))

    def test_round_trip_preserves_document_and_viewer_generation(self):
        with patch.object(self.store, 'rows', return_value=[self.row]):
            self.assertEqual(download(self.store, self.directory), 1)
        documents = local_recipes(self.directory)
        self.assertEqual(documents, [self.document])
        self.assertEqual(revisions(self.directory, self.store.url), {self.row['recipe_id']: 1})
        self.assertIn('scrambled-eggs.html', build_site(self.directory, self.directory / 'html'))
        html = (self.directory / 'html/index.html').read_text()
        library = json.loads(html.split('<script id="library-data" type="application/json">', 1)[1].split('</script>', 1)[0])
        graph = compile_recipe(self.document)
        self.assertEqual(library['recipes'], [{
            'id': 'saved-scrambled-eggs', 'page': 'scrambled-eggs.html',
            'graph': graph, 'steps': action_order(graph),
        }])
        self.assertIn('New recipe', html)
        self.assertNotIn(self.store.key, html)
        with patch.object(self.store, 'request', return_value=[self.row]) as request:
            self.assertEqual(upload(self.store, self.directory, documents), 1)
        self.assertEqual(request.call_args.args[1]['p_recipes'][0]['expected_revision'], 1)

    def test_download_refuses_to_overwrite_local_edits(self):
        path = self.directory / 'scrambled-eggs.recipe.json'
        path.write_text('{"local": "edits"}')
        with patch.object(self.store, 'rows', return_value=[self.row]):
            with self.assertRaisesRegex(ValueError, 'Refusing to overwrite'):
                download(self.store, self.directory)
            self.assertEqual(json.loads(path.read_text()), {'local': 'edits'})
            self.assertFalse((self.directory / STATE_NAME).exists())
            download(self.store, self.directory, overwrite=True)
        self.assertEqual(json.loads(path.read_text()), self.document)

    def test_rejects_invalid_remote_documents_before_writing(self):
        bad = copy.deepcopy(self.row)
        bad['document']['steps'][0]['inputs'] = ['missing']
        with patch.object(self.store, 'request', return_value=[self.row, bad]):
            with self.assertRaises(ValueError):
                download(self.store, self.directory)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_and_duplicate_local_recipes_rejected(self):
        path = self.directory / 'one.recipe.json'
        path.write_text(json.dumps(self.document))
        (self.directory / 'two.recipe.json').write_text(json.dumps(self.document))
        with self.assertRaisesRegex(ValueError, 'Duplicate recipe ID'):
            local_recipes(self.directory)
        path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Invalid recipe'):
            local_recipes(self.directory)

    def test_first_upload_has_no_expected_revision_and_records_result(self):
        with patch.object(self.store, 'request', return_value=[self.row]) as request:
            upload(self.store, self.directory, [self.document])
        self.assertIsNone(request.call_args.args[1]['p_recipes'][0]['expected_revision'])
        self.assertEqual(revisions(self.directory, self.store.url), {self.row['recipe_id']: 1})

    def test_conflict_preserves_revision_tracking(self):
        with patch.object(self.store, 'request', return_value=[self.row]):
            upload(self.store, self.directory, [self.document])
        before = (self.directory / STATE_NAME).read_bytes()
        with patch.object(self.store, 'request', side_effect=ValueError('Upload conflict')):
            with self.assertRaisesRegex(ValueError, 'Upload conflict'):
                upload(self.store, self.directory, [self.document])
        self.assertEqual((self.directory / STATE_NAME).read_bytes(), before)

    def test_revisions_cannot_be_reused_with_another_project(self):
        with patch.object(self.store, 'request', return_value=[self.row]):
            upload(self.store, self.directory, [self.document])
        with self.assertRaisesRegex(ValueError, 'another project'):
            revisions(self.directory, 'https://other.supabase.co')

    def test_keyset_pagination_does_not_assume_server_page_size(self):
        second = copy.deepcopy(self.row)
        second['recipe_id'] = second['document']['recipeId'] = 'z-eggs'
        with patch.object(self.store, 'request', side_effect=[[self.row], [second], []]) as request:
            self.assertEqual(len(self.store.rows()), 2)
        self.assertIn('recipe_id=gt.scrambled-eggs', request.call_args_list[1].args[0])

    def test_row_identity_and_revision_are_checked(self):
        for change in ({'recipe_id': '../escape'}, {'revision': 0}, {'revision': True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_rows([{**self.row, **change}])

    def test_secret_header_and_no_secret_in_errors(self):
        for key in ('sb_secret_test', 'legacy-service-role-jwt'):
            with self.subTest(key=key):
                store = RecipeStore(self.store.url, key)
                error = HTTPError('url', 403, 'Forbidden', {}, BytesIO(json.dumps({'message': key}).encode()))
                opener = Mock()
                opener.open.side_effect = error
                with patch('supabase_recipes.build_opener', return_value=opener):
                    with self.assertRaises(ValueError) as caught:
                        store.request('recipes')
                self.assertNotIn(key, str(caught.exception))
                headers = dict(opener.open.call_args.args[0].header_items())
                self.assertEqual(headers['Apikey'], key)
                self.assertEqual('Authorization' in headers, not key.startswith('sb_secret_'))

    def test_conflict_http_response_is_actionable(self):
        error = HTTPError('url', 409, 'Conflict', {}, BytesIO(b'{"code":"PT409"}'))
        with patch('supabase_recipes.build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaisesRegex(ValueError, 'no recipes were saved'):
                self.store.request('rpc/save_recipes', {})

    def test_credentials_require_https_except_local_development(self):
        for url in ('http://example.com', 'https://user:password@example.com', 'https://example.com/path'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                RecipeStore(url, 'secret')
        self.assertEqual(RecipeStore('http://127.0.0.1:54321', 'secret').url, 'http://127.0.0.1:54321')


if __name__ == '__main__':
    unittest.main()
