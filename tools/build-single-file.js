#!/usr/bin/env node
/**
 * Fabrique une version « un seul fichier » de HomeBoard : CSS, modules ES et
 * plan de la maison sont inlinés dans un unique HTML autonome, pratique pour
 * partager le prototype ou l'ouvrir sans serveur de fichiers.
 *
 *   node tools/build-single-file.js  ->  dist/homeboard.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = ['base', 'layout', 'components'];
const ENTRY = 'app';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/**
 * Ordre de concaténation déduit des `import` : ajouter un module au projet
 * suffit, il n'y a pas de liste à tenir à jour ici.
 */
function moduleOrder(entry) {
  const order = [];
  const seen = new Map(); // 'visiting' | 'done'

  const visit = (name, stack) => {
    if (seen.get(name) === 'done') return;
    if (seen.get(name) === 'visiting') {
      throw new Error(`Dépendance circulaire : ${[...stack, name].join(' -> ')}`);
    }
    seen.set(name, 'visiting');

    const src = read('assets', 'js', `${name}.js`);
    for (const m of src.matchAll(/from '\.\/([a-z-]+)\.js'/g)) {
      visit(m[1], [...stack, name]);
    }

    seen.set(name, 'done');
    order.push(name);
  };

  visit(entry, []);
  return order;
}

const JS = moduleOrder(ENTRY);

/**
 * Retire les `import`/`export` : tout se retrouve dans une seule portée.
 * Les imports renommés (`import { icon as iconSvg }`) deviennent un alias local,
 * sans quoi le nom d'origine disparaîtrait du module.
 */
function stripModuleSyntax(src) {
  return src
    .replace(/^import\s+\{([\s\S]*?)\}\s+from\s+'[^']+';[ \t]*$/gm, (_, bindings) => bindings
      .split(',')
      .map((binding) => binding.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/))
      .filter(Boolean)
      .map(([, original, alias]) => `const ${alias} = ${original};`)
      .join('\n'))
    .replace(/^import[\s\S]*?from\s+'[^']+';[ \t]*$/gm, '')
    .replace(/^export\s+\{[^}]*\};[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
}

/** Déclarations de premier niveau (colonne 0) d'un module. */
function topLevelNames(src) {
  const names = [];
  const re = /^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

const seen = new Map();
const renames = [];

const modules = JS.map((name) => {
  let src = stripModuleSyntax(read('assets', 'js', `${name}.js`));

  // Deux modules peuvent avoir un helper privé du même nom (`clamp`…) :
  // on suffixe le second pour éviter la collision une fois tout concaténé.
  for (const decl of topLevelNames(src)) {
    if (!seen.has(decl)) { seen.set(decl, name); continue; }
    const alias = `${decl}_${name}`;
    src = src.replace(new RegExp(`\\b${decl}\\b`, 'g'), alias);
    renames.push(`${decl} (${name}) -> ${alias}`);
  }

  return `// ---------- ${name}.js ----------\n${src.trim()}\n`;
});

const configText = read('config', 'home.json');

// La configuration est embarquée : plus de fetch(), donc plus besoin de serveur.
const appIndex = JS.indexOf('app');
modules[appIndex] = modules[appIndex].replace(
  /const response = await fetch\('config\/home\.json'\);[\s\S]*?app\.defaultConfigText = await response\.text\(\);/,
  'app.defaultConfigText = HOMEBOARD_CONFIG;'
);
if (!modules[appIndex].includes('HOMEBOARD_CONFIG')) {
  throw new Error('Le chargement de config/home.json n’a pas pu être remplacé — vérifier app.js.');
}

const bundle = [
  `const HOMEBOARD_CONFIG = ${JSON.stringify(configText)};`,
  ...modules
].join('\n');

const styles = CSS.map((name) => read('assets', 'css', `${name}.css`)).join('\n');

// Le fichier autonome ne peut pas référencer les ressources voisines.
// Le favicon est réinjecté en data URI : un fichier autonome ne peut pas
// pointer vers ses voisins, et sans lui le navigateur réclame /favicon.ico.
const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${
  encodeURIComponent(read('assets', 'icon.svg').replace(/\n\s*/g, ' ')).replace(/'/g, '%27')}">`;

const html = read('index.html')
  .replace(/^\s*<link rel="stylesheet" href="assets\/css\/[a-z]+\.css">\n/gm, '')
  .replace(/^\s*<link rel="(?:manifest|apple-touch-icon)"[^>]*>\n/gm, '')
  .replace(/^(\s*)<link rel="icon"[^>]*>$/gm, `$1${favicon}`)
  .replace('</head>', `  <style>\n${styles}\n  </style>\n</head>`)
  .replace(
    '<script type="module" src="assets/js/app.js"></script>',
    `<script type="module">\n${bundle}\n  </script>`
  );

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'homeboard.html'), html);

console.log(`dist/homeboard.html — ${(html.length / 1024).toFixed(0)} Ko`);
if (renames.length) console.log('renommages :', renames.join(', '));
