// Update the page in place instead of replacing it: only what changed is touched, so images
// don't reload, scroll and focus stay put and CSS transitions (switches, bars, colors) play.
window.HD = window.HD || {};

(function () {
  // Elements that keep their identity across renders (modules, header items, keyed buttons).
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-mod') || n.getAttribute('data-hitem') || n.id || null : null);

  function syncAttrs(a, b) {
    const old = a.attributes;
    for (let i = old.length - 1; i >= 0; i--) {
      const name = old[i].name;
      // A <details> the user opened stays open.
      if (!b.hasAttribute(name) && !(name === 'open' && a.nodeName === 'DETAILS')) a.removeAttribute(name);
    }
    const neu = b.attributes;
    for (let i = 0; i < neu.length; i++) {
      const { name, value } = neu[i];
      if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    }
  }

  function morphNode(a, b) {
    if (a.nodeType !== 1) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      return;
    }
    syncAttrs(a, b);
    const tag = a.nodeName;
    const focused = a === document.activeElement;
    if (tag === 'INPUT') {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (!focused) { const v = b.getAttribute('value') || ''; if (a.value !== v) a.value = v; }
      return;
    }
    if (tag === 'TEXTAREA') {
      if (!focused && a.value !== b.textContent) a.value = b.textContent;
      return;
    }
    morphChildren(a, b);
    if (tag === 'SELECT' && !focused) {
      const sel = [...b.options].findIndex((o) => o.hasAttribute('selected'));
      if (sel >= 0 && a.selectedIndex !== sel) a.selectedIndex = sel;
    }
  }

  function same(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
  }

  function morphChildren(from, to) {
    const keyed = new Map();
    for (let n = from.firstChild; n; n = n.nextSibling) { const k = keyOf(n); if (k) keyed.set(k, n); }
    let cur = from.firstChild;
    const kids = [...to.childNodes];
    for (const b of kids) {
      const k = keyOf(b);
      let match = null;
      if (k) {
        const m = keyed.get(k);
        if (m && same(m, b)) { match = m; keyed.delete(k); }
      } else if (cur && !keyOf(cur) && same(cur, b)) match = cur;
      if (match) {
        if (match === cur) cur = cur.nextSibling;
        else from.insertBefore(match, cur);
        morphNode(match, b);
      } else {
        from.insertBefore(b, cur); // moves the new node out of the template
      }
    }
    while (cur) { const next = cur.nextSibling; from.removeChild(cur); cur = next; }
  }

  // Replace the content of `root` with `html`, reusing the existing nodes where possible.
  HD.morph = function (root, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    morphChildren(root, tpl.content);
  };
})();
