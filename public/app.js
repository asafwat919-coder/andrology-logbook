// Electronic Andrology Logbook — progressive enhancements (the app works without JS).
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Sidebar (mobile)
  $$('[data-toggle-sidebar]').forEach(function (b) {
    b.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
  });

  // Flash dismiss + auto-hide success
  $$('[data-dismiss]').forEach(function (b) { b.addEventListener('click', function () { b.closest('.flash').remove(); }); });
  $$('.flash-success').forEach(function (f) { if (/password/i.test(f.textContent)) return; setTimeout(function () { f.classList.add('fade'); setTimeout(function () { f.remove(); }, 400); }, 6000); });

  // Confirm buttons
  $$('[data-confirm]').forEach(function (b) {
    b.addEventListener('click', function (e) { if (!window.confirm(b.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // Demo account fill
  $$('[data-fill-email]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.closest('form');
      f.querySelector('[name=email]').value = b.getAttribute('data-fill-email');
      f.querySelector('[name=password]').value = b.getAttribute('data-fill-password');
      f.submit();
    });
  });

  // Select all + count
  $$('[data-check-all]').forEach(function (all) {
    var form = all.closest('form') || document;
    var boxes = function () { return $$('input[name=ids]', form); };
    var counter = $('[data-selected-count]', form);
    var update = function () { var n = boxes().filter(function (b) { return b.checked; }).length; if (counter) counter.textContent = n + ' selected'; form.classList && form.classList.toggle('has-selection', n > 0); };
    all.addEventListener('change', function () { boxes().forEach(function (b) { b.checked = all.checked; }); update(); });
    boxes().forEach(function (b) { b.addEventListener('change', update); });
    update();
  });

  // Clickable table rows
  $$('tr[data-href]').forEach(function (tr) {
    tr.addEventListener('click', function (e) { if (e.target.closest('a,button,input,label')) return; window.location = tr.getAttribute('data-href'); });
  });

  // File input names
  $$('[data-file-input]').forEach(function (inp) {
    var out = inp.closest('.field').querySelector('[data-file-names]');
    inp.addEventListener('change', function () {
      out.innerHTML = '';
      Array.prototype.forEach.call(inp.files, function (f) {
        var s = document.createElement('span'); s.className = 'chip';
        s.textContent = f.name + ' · ' + Math.ceil(f.size / 1024) + ' KB'; out.appendChild(s);
      });
    });
  });

  // Conditional fields (e.g. "Other" operation name)
  $$('[data-show-if]').forEach(function (field) {
    var parts = field.getAttribute('data-show-if').split('=');
    var ctl = field.closest('form').querySelector('[name="' + parts[0] + '"]');
    var input = field.querySelector('input,select,textarea');
    var sync = function () { var on = ctl.value === parts[1]; field.hidden = !on; if (input) input.required = on; };
    ctl.addEventListener('change', sync); sync();
  });

  // Requirements row totals
  $$('[data-sum-row]').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var id = inp.getAttribute('data-sum-row');
      var total = $$('[data-sum-row="' + id + '"]').reduce(function (a, i) { return a + (parseInt(i.value, 10) || 0); }, 0);
      var out = $('[data-sum-out="' + id + '"]'); if (out) out.textContent = total || '—';
    });
  });

  // Embedded (e.g. inside Google Sites): offer to open full-size in a new tab
  var inFrame = false; try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  if (inFrame) { document.body.classList.add('embedded'); $$('[data-embed-open]').forEach(function (a) { a.href = location.href; a.hidden = false; }); }

  // Print
  $$('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
  if (/[?&]print=1/.test(location.search)) setTimeout(function () { window.print(); }, 400);

  window.addEventListener('pageshow', function () { $$('form button').forEach(function (b) { b.disabled = false; }); });
  // Prevent double submit
  $$('form').forEach(function (f) {
    f.addEventListener('submit', function () {
      setTimeout(function () { $$('button', f).forEach(function (b) { b.disabled = true; }); }, 0);
    });
  });
})();
