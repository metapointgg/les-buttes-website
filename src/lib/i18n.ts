export type SiteLanguage = 'en' | 'nl' | 'fr';
export const languages: SiteLanguage[] = ['en','nl','fr'];
export const languageNames: Record<SiteLanguage,string> = {en:'English',nl:'Nederlands',fr:'Français'};
export function languageFromPath(path:string):SiteLanguage {
  const prefix=path.split('/')[1];
  return prefix === 'nl' || prefix === 'fr' ? prefix : 'en';
}
export function unprefixPath(path:string):string {
  return path.replace(/^\/(nl|fr)(?=\/|$)/,'') || '/';
}
export function localPath(path:string,language:SiteLanguage):string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const clean=unprefixPath(path);
  return language==='en' ? clean : `/${language}${clean}`;
}
export function localizedText(value:any,language:SiteLanguage):any {
  if (Array.isArray(value)) return value.map(item=>localizedText(item,language));
  if (!value || typeof value!=='object') return value;
  const result:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value)){
    if (/Nl$|Fr$/.test(key)) continue;
    if (typeof item==='string' && /(?:Url|Href)$/.test(key)) {
      result[key]=localPath(item,language);
    } else if (language!=='en' && typeof item==='string' && typeof (value as any)[key+(language==='nl'?'Nl':'Fr')]==='string' && (value as any)[key+(language==='nl'?'Nl':'Fr')].trim()) {
      result[key]=(value as any)[key+(language==='nl'?'Nl':'Fr')];
    } else {
      result[key]=localizedText(item,language);
    }
  }
  return result;
}
