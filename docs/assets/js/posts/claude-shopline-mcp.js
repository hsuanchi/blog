(() => {
  function copyWithSelection(value) {
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = [];
    if (selection) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        ranges.push(selection.getRangeAt(index).cloneRange());
      }
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.readOnly = true;
    field.tabIndex = -1;
    field.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px;';
    document.body.appendChild(field);
    try {
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, value.length);
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      field.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        ranges.forEach((range) => selection.addRange(range));
      }
    }
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // The selection method also works when the Clipboard API is unavailable.
      }
    }
    copyWithSelection(value);
  }

  document.querySelectorAll('.shopline-mcp-guide [data-copy-target]').forEach((button) => {
    const target = document.getElementById(button.dataset.copyTarget);
    const card = button.closest('[data-copy-card]');
    const label = button.querySelector('[data-copy-label]');
    const status = card?.querySelector('[role="status"]');
    if (!target || !card || !label || !status) return;
    button.addEventListener('click', async () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      label.textContent = '複製中';
      delete button.dataset.copyState;
      delete card.dataset.copyState;
      try {
        await copyText(target.textContent.trim());
        button.dataset.copyState = 'success';
        card.dataset.copyState = 'success';
        label.textContent = '已複製';
        status.textContent = '網址已複製，可以貼到 Claude 了。';
      } catch {
        button.dataset.copyState = 'error';
        card.dataset.copyState = 'error';
        label.textContent = '重試複製';
        status.textContent = '無法自動複製，請選取上方網址後手動複製。';
      } finally {
        button.removeAttribute('aria-busy');
      }
    });
  });
})();
