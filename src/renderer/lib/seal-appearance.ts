/** Local art variant only; never grants collection access. */
export const SEAL_APPEARANCE_KEY='mm.sappy-seal.alternate.v1'
export const SEAL_APPEARANCE_EVENT='mm-sappy-seal-appearance'
export function alternateSeal():boolean {
  try{return localStorage.getItem(SEAL_APPEARANCE_KEY)==='1'}catch{return false}
}
export function setAlternateSeal(value:boolean):void {
  try{localStorage.setItem(SEAL_APPEARANCE_KEY,value?'1':'0')}catch{/* Local storage unavailable. */}
  window.dispatchEvent(new Event(SEAL_APPEARANCE_EVENT))
}
