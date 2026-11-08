(function () {
  var btn = document.getElementById('copyPrompt');
  if (!btn) return;
  btn.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById('promptText').textContent).then(function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy prompt'; }, 2000);
    });
  });
})();
