// Apply the saved appearance before the stylesheet paints to avoid a dark flash.
try { document.documentElement.dataset.theme = localStorage.getItem('awb-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
