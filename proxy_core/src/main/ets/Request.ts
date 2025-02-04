import { rcp } from "@kit.RemoteCommunicationKit";

// TODO 可添加其他来源
const IpCountryList: IpResolver[] = [{
  url: "https://api.vore.top/api/IPdata?ip=",
  resolve: (json, text)=>{
    return json["ipdata"]["info1"] as string
  }
}]
const ipInfoSources: IpResolver[]  = [
  {
    url: "https://ipwho.is/?fields=ip&output=csv",
    resolve: (json, text)=>{
      return json["ip"] as string
    }
  },
  {
    url:  "https://ipinfo.io/ip",
    resolve: (json, text)=>{
      return text
    }
  },
  {
    url: "https://ifconfig.me/ip/",
    resolve: (json, text)=>{
      return json["ip"] as string
    }
  },

];

export async function CallIpResolver(ip: string | undefined, resolver: IpResolver | string): Promise<string | null>{
  const session = rcp.createSession({requestConfiguration: {transfer: {timeout: { connectMs: 3000, transferMs: 3000, inactivityMs: 3000 }}}});
  const url = typeof resolver == "string" ? resolver as string : resolver.url
  let json = null
  try {
    const resp = await session.get(url + ip ?? "")
    if(resp.statusCode !== 200)
      return null;
    if (typeof resolver == "string" ){
      return resp.toString()
    }
    json = resp.toJSON()
    let result = resolver.resolve(json, resp.toString())
    session.close()
    return result;
  } catch (e) {
    console.error("CallIpResolver error: ",url,ip, e)
    return null
  }
}
export async function queryIpInfo(ip: string){
  for (let resolver of IpCountryList) {
    const result = await CallIpResolver(ip, resolver)
    if (!result)
      continue
    return result
  }
  return "";
}
export async function checkIp() {
  for (let source of ipInfoSources) {
    const result = await CallIpResolver(undefined, source)
    if (!result)
      continue
    return result
  }
  return ""
}

export interface IpResolver{
    url: string
    resolve: (json: object, text: string) => string
}