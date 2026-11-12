"""Regenerate recipe viewers and serve their output on localhost."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from compile_recipe import compile_recipe
from recipe_viewer_data import action_order
from visualize_recipe_graph import render_document, render_graph


ROOT = Path(__file__).resolve().parents[1]


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def build_site(recipes: Path, output: Path) -> list[str]:
    output.mkdir(parents=True, exist_ok=True)
    pages = ['index.html']
    library = []
    for path in sorted(recipes.glob('*.recipe.json')):
        recipe = json.loads(path.read_text(encoding='utf-8'))
        graph = compile_recipe(recipe)
        recipe_id = graph['recipeId']
        page = 'index.recipe.html' if recipe_id == 'index' else recipe_id + '.html'
        if page in pages:
            raise ValueError(f'Duplicate recipe ID: {recipe_id}')
        (output / page).write_text(render_graph(graph, has_recipe_index=True), encoding='utf-8')
        pages.append(page)
        library.append({'id': 'saved-' + recipe_id, 'page': page, 'graph': graph, 'steps': action_order(graph)})
    (output / 'index.html').write_text(render_document({'recipes': library}), encoding='utf-8')
    return pages


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--build-only', action='store_true', help='Generate static HTML and exit without serving')
    parser.add_argument('--source', choices=['files', 'supabase'], default='files',
                        help='Read local recipe files (default) or private Supabase recipe storage')
    args = parser.parse_args()
    output = ROOT / 'visualizations'
    if args.source == 'supabase':
        from supabase_recipes import RecipeStore, download
        with TemporaryDirectory(prefix='cooking-recipes-') as temporary:
            recipes = Path(temporary)
            try:
                download(RecipeStore.from_env(), recipes)
                pages = build_site(recipes, output)
            except (ValueError, OSError) as exc:
                parser.exit(1, f'{exc}\n')
    else:
        pages = build_site(ROOT / 'recipes', output)
    if args.build_only:
        for page in pages:
            print(f'Created {output / page}')
        return
    handler = partial(PreviewHandler, directory=str(output))
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        for page in pages:
            print(f'http://127.0.0.1:{server.server_port}/{page}', flush=True)
        print('Press Ctrl+C to stop. Restart to regenerate after source changes.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
