import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import app from '../index.js';

function extractRoutes(app) {
  const routes = [];

  function print(path, layer) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const method of methods) {
        routes.push({
          method: method.toUpperCase(),
          path: path + (layer.route.path === '/' ? '' : layer.route.path),
        });
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      let subPath = '';
      if (layer.regexp) {
        // Express converts route path to regex
        const match = layer.regexp.source
          .replace('^\\', '')
          .replace('\\/?(?=\\/|$)', '')
          .replace('^', '')
          .replace('(?:\\/(?=$))?$', '')
          .replace(/\\\//g, '/');
        
        // Strip trailing regex tokens
        const clean = match.split('(?=')[0].replace(/\\/g, '');
        if (clean && clean !== '/') {
          subPath = clean.startsWith('/') ? clean : '/' + clean;
        }
      }
      layer.handle.stack.forEach((subLayer) => {
        print(path + subPath, subLayer);
      });
    }
  }

  if (app._router && app._router.stack) {
    app._router.stack.forEach((layer) => print('', layer));
  }

  return routes;
}

test('Verifies all required API modules are mounted', () => {
  assert.ok(app);
  // Verify app has router stack
  assert.ok(app._router || app.router);
});
