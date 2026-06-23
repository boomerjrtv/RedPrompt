const { chromium } = require('playwright');

(async () => {
  const flagSets = [
    { name: 'headful-default', args: ['--enable-unsafe-webgpu', '--no-sandbox'] },
    { name: 'headful-vulkan', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=vulkan', '--no-sandbox'] },
    { name: 'headful-egl', args: ['--enable-unsafe-webgpu', '--use-gl=egl', '--no-sandbox'] },
    { name: 'headful-desktop-gl', args: ['--enable-unsafe-webgpu', '--use-gl=desktop', '--no-sandbox'] },
  ];
  for (const fs of flagSets) {
    let browser;
    try {
      browser = await chromium.launch({ headless: false, args: fs.args });
      const page = await browser.newPage();
      await page.goto('about:blank');
      const res = await page.evaluate(async () => {
        const out = { gpu: !!navigator.gpu, ua: navigator.userAgent };
        if (!navigator.gpu) return out;
        try {
          const adapter = await Promise.race([
            navigator.gpu.requestAdapter(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('adapter timeout')), 10000)),
          ]);
          out.adapter = !!adapter;
          if (adapter) {
            out.info = adapter.info || null;
            out.features = Array.from(adapter.features || []);
            out.hasShaderF16 = adapter.features?.has('shader-f16') || false;
            try {
              const req = out.hasShaderF16 ? ['shader-f16'] : [];
              const dev = await adapter.requestDevice({ requiredFeatures: req });
              out.device = true;
              dev.destroy?.();
            } catch (e) { out.deviceError = String(e.message || e); }
          }
        } catch (e) { out.error = String(e.message || e); }
        return out;
      });
      console.log(JSON.stringify({ flagSet: fs.name, args: fs.args, result: res }, null, 2));
      await browser.close();
    } catch (e) {
      console.log(JSON.stringify({ flagSet: fs.name, launchError: String(e.message || e) }, null, 2));
      try { await browser?.close(); } catch {}
    }
  }
})();
