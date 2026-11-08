"""Regenerate recipe viewers and serve their output on localhost."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

from compile_recipe import compile_recipe
from visualize_recipe_graph import render_graph


ROOT = Path(__file__).resolve().parents[1]


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    output = ROOT / 'visualizations'
    output.mkdir(exist_ok=True)
    pages = []
    for path in sorted((ROOT / 'recipes').glob('*.recipe.json')):
        graph = compile_recipe(json.loads(path.read_text(encoding='utf-8')))
        document = render_graph(graph)
        page = graph['recipeId'] + '.html'
        (output / page).write_text(document, encoding='utf-8')
        pages.append(page)
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
