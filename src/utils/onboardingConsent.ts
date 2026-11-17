export const TERMS_VERSION='2026-11-17';
export const TERMS_ACCEPTANCE_KEY='app_terms_acceptance';
export function reachedTermsEnd({scrollTop,scrollHeight,clientHeight}:{scrollTop:number;scrollHeight:number;clientHeight:number}){
 return [scrollTop,scrollHeight,clientHeight].every(Number.isFinite)&&clientHeight>0&&scrollHeight>0&&scrollHeight-Math.max(0,scrollTop)-clientHeight<=2;
}
export function canAcceptTerms(readToEnd:boolean,checked:boolean){return readToEnd&&checked;}
export function acceptTerms(storage:Pick<Storage,'setItem'>){
 try{storage.setItem(TERMS_ACCEPTANCE_KEY,JSON.stringify({version:TERMS_VERSION,acceptedAt:new Date().toISOString()}));}catch{/* Consent remains in memory if persistent storage is unavailable. */}
}
export function hasAcceptedTerms(storage:Pick<Storage,'getItem'>){
 try{const value=JSON.parse(storage.getItem(TERMS_ACCEPTANCE_KEY)||'null');return value?.version===TERMS_VERSION&&Number.isFinite(Date.parse(value.acceptedAt));}catch{return false;}
}
export const BEIJING_TOUR_CENTER:[number,number]=[116.4074,39.9042];
