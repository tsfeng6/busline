export async function readCityJSON(urls:string[],transport:typeof fetch=(input,init)=>globalThis.fetch(input,init)){
  let lastError:any=null,onlyMissing=true;
  for(const url of [...new Set(urls)]){
    try{
      const response=await transport(url,{signal:AbortSignal.timeout(url.startsWith('/')?30000:8000),cache:'no-cache'});
      if(!response.ok){if(response.status!==404)onlyMissing=false;throw Object.assign(Error('共享线路服务暂时不可用。'),{status:response.status});}
      // A development server can return HTML instead of a JSON 404.
      const result=await response.json();
      return result;
    }catch(error:any){lastError=error;if(error.status!==404)onlyMissing=false;}
  }
  throw Object.assign(Error(onlyMissing?'该城市暂无历史快照。':'共享线路读取失败，请检查网络或稍后重试。'),{status:onlyMissing?404:lastError?.status||503});
}
