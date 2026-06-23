const { chromium } = require('playwright');
const combos = [
  ['--enable-unsafe-webgpu','--enable-features=WebGPU'],
  ['--enable-unsafe-webgpu','--enable-features=UnsafeWebGPU'],
  ['--enable-unsafe-webgpu','--enable-features=WebGPUDeveloperFeatures'],
  ['--enable-unsafe-webgpu','--enable-features=WebGPU,WebGPUDeveloperFeatures,UnsafeWebGPU'],
  ['--enable-dawn-features=allow_unsafe_apis'],
  ['--enable-unsafe-webgpu','--enable-dawn-features=allow_unsafe_apis'],
  ['--enable-unsafe-webgpu','--disable-dawn-features=disallow_unsafe_apis'],
  ['--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures','--use-angle=vulkan'],
];
(async()=>{
 for (let i=0;i<combos.length;i++){
  let args=[...combos[i],'--no-sandbox'];
  let browser;
  try{
   browser=await chromium.launch({headless:false,args});
   const page=await browser.newPage();
   await page.goto('https://boomerjrtv.github.io/RedPrompt/?flagtest='+i);
   const res=await page.evaluate(async()=>{
    const out={gpu:!!navigator.gpu, secure:isSecureContext};
    if(navigator.gpu){
      const a=await navigator.gpu.requestAdapter();
      out.adapter=!!a;
      out.features=a?Array.from(a.features):[];
      out.hasShaderF16=!!a?.features?.has('shader-f16');
    }
    return out;
   });
   console.log(JSON.stringify({i,args,res},null,2));
  }catch(e){console.log(JSON.stringify({i,args,error:String(e.message||e)},null,2));}
  try{await browser?.close()}catch{}
 }
})();
