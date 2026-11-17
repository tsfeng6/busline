/** Exact route: also works when catch-all routing or Blob initialization is unavailable. */
export function onRequest({env}:{env:Record<string,string>|undefined}) {
  return new Response(JSON.stringify({service:'busline-city-gateway',platform:'edgeone',version:1,
    probe:'explicit-health-v1',configured:!!env?.GITHUB_DISPATCH_TOKEN&&(env?.CALLBACK_SECRET?.length||0)>=32&&(env?.RATE_LIMIT_SALT?.length||0)>=16}),
    {headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Busline-Gateway':'explicit-health-v1'}});
}
