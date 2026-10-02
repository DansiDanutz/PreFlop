import { api } from './server.mjs';
export function createWorker(assets){
  return { async fetch(request,env){
    const pathname=new URL(request.url).pathname;
    if(pathname.startsWith('/api/'))return api(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const asset=assets[pathname] || (pathname==='/'?assets['/index.html']:null);
    if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{
      'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
      'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    }});
  }};
}
