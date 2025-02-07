import { vpnExtension, socket } from '@kit.NetworkKit';
import {
  startTun, stopTun, setFdMap, getVpnOptions, startLog, getProxies, getTraffic,
  getTotalTraffic,
  getExternalProviders,
  asyncTestDelay,
  updateConfig,
  initClash,
  changeProxy,
  forceGc,
  updateExternalProvider,
  getCountryCode,
  updateGeoData,
  sideLoadExternalProvider
} from 'libflclash.so';
import { Address, CommonVpnService, isIpv4, isIpv6, VpnConfig } from './CommonVpnService';
import { JSON, util } from '@kit.ArkTS';
import { RpcRequest } from './RpcRequest';
import { ClashRpcType } from './IClashManager';
import { LogInfo, Provider, ProxyGroup, ProxyMode, ProxyType, Traffic } from '../models/Common';
import { getHome } from '../appPath';
import { UpdateConfigParams } from '../models/ClashConfig';
import { pointer } from '@kit.InputKit';
import { readFile, readFileUri } from '../fileUtils';

export interface AccessControl{
  mode:              string
  acceptList:        string[]
  rejectList:        string[]
  isFilterSystemApp: boolean
}
export  interface VpnOptions{
  enable: boolean,
  port: number,
  ipv4Address: string,
  ipv6Address: string,
  accessControl: AccessControl,
  systemProxy: string,
  allowBypass: boolean,
  routeAddress: string[],
  bypassDomain: string[],
  dnsServerAddress: string,
}


export class FlClashVpnService extends CommonVpnService{
  noVpn: boolean = false // 模拟器开启
  running: boolean = false
  vpnConnection : vpnExtension.VpnConnection | undefined
  public configPath: string = ""
  protectSocketPath: string = ""

  override async onRemoteMessageRequest(client: socket.LocalSocketConnection, message: socket.LocalSocketMessageInfo): Promise<void>{
    let decoder = new util.TextDecoder()
    let request = JSON.parse(decoder.decodeToString(new Uint8Array(message.message))) as RpcRequest
    let code = request.method
    let params = request.params
    console.debug(`socket stub ${code as ClashRpcType} request: `, params)
    if(code == ClashRpcType.setLogObserver){
      // 订阅日志，需要持续输出
      startLog((message: string, value: string)=>{
        if (typeof value === "string"){
          try {
            const log = JSON.parse(value)
            this.sendClient(client, JSON.stringify({
              logLevel: log["data"]["LogLevel"],
              payload: log["data"]["Payload"],
              time: new Date().getTime(),
            } as LogInfo))
          }catch (e) {
            console.error("log error", value)
          }
        }
      })
    } else {
      try {
        let result = await this.onRemoteMessage(code, params)
        console.debug(`socket stub ${code} result: `, result)
        this.sendClient(client, JSON.stringify({ result: result}))
      } catch (e) {
        console.error(`socket stub ${code} result: `, e.message, e.stack)
        this.sendClient(client, JSON.stringify({ result: e.message}))
      }
    }
  }

  onRemoteMessage(code: number, data: (string | number| boolean)[]): Promise<string | number | boolean> {
    // 根据code处理客户端的请求
    return new Promise(async (resolve, reject) => {
      switch (code){

        case ClashRpcType.queryTrafficTotal:{
          const data = JSON.parse(getTotalTraffic())
          resolve(JSON.stringify({ upRaw: data["up"], downRaw: data["down"]} as Traffic))
          break;
        }
        case ClashRpcType.queryTrafficNow:{
          const data = JSON.parse(getTraffic())
          resolve(JSON.stringify({ upRaw: data["up"], downRaw: data["down"]} as Traffic))
          break;
        }
        case ClashRpcType.queryProxyGroup:{
          let result = getProxies()
          let map = JSON.parse(result as string) as Record<string, string | Record<string, string[] | string>>
          let groupNames = map[ProxyMode.Global]["all"] as string[]
          if(data[0] == ProxyMode.Global){
            groupNames = ["GLOBAL", ...groupNames]
          } else if(data[0] == ProxyMode.Rule) {
            groupNames = groupNames
          }else{
            groupNames = []
          }
          groupNames = groupNames.filter(e => {
            const proxy = map[e] as Record<string, string>
            const indexes = ["Selector","URLTest", "Fallback", "LoadBalance", "Relay"].indexOf(proxy["type"])
            return indexes > -1
          })
          const groupsRaw = groupNames.map((groupName) =>{
            const group = map[groupName];
            group["proxies"] = (group["all"] ?? []).map((n:string) =>{
              map[n]["name"] = map[n]["name"]
              return map[n]
            }).filter((d: string) => d != null && d != undefined)
            return {
              name: group["name"] as string,
              now: group["now"] as string,
              type: group["type"] as ProxyType,
              hidden: group["hidden"] == true,
              icon: group["icon"] as string,
              proxies: group["proxies"]
            } as ProxyGroup
          })
          resolve(JSON.stringify(groupsRaw))
          break;
        }

        case ClashRpcType.changeProxy:{
          resolve(changeProxy(JSON.stringify({
            "group-name": data[0] as string,
            "proxy-name": data[1] as string,
          })))
          break;
        }
        case ClashRpcType.healthCheck:{
          asyncTestDelay(JSON.stringify({
            "proxy-name": data[0] as string,
            timeout: data[1] as string,
          })).then((v)=>{
            if (v != ""){
              resolve(JSON.parse(v)["value"])
            }else{
              resolve(-1)
            }
          }).catch((e)=> {
            console.error("healthCheck error", e)
            resolve(0)
          })
          break;
        }
        case ClashRpcType.queryProviders:{
          const provider = getExternalProviders()
          resolve(provider)
          break;
        }
        case ClashRpcType.updateProvider:{
          const params = JSON.parse(data[0] as string)
          updateExternalProvider(params["name"]).then((v)=>{
            resolve(v)
          })
          break;
        }
        case ClashRpcType.uploadProvider:{
          let provider = data[0] as string
          let pathUri = data[1] as string
          const temp = this.context.filesDir + "/temp_provider"
          const buffer = await readFileUri(pathUri, temp)
          sideLoadExternalProvider(provider, buffer).then((v)=>{
            resolve(v)
          })
          break;
        }
        case ClashRpcType.patchOverride:{
          //nativeWriteOverride(data[0] as number, data[1] as string)
          resolve(true)
          break;
        }
        case ClashRpcType.clearOverride:{
          //nativeClearOverride(data[0] as number)
          resolve(true)
          break;
        }
        case ClashRpcType.updateGeoData:{
          updateGeoData(data[0] as string, data[1] as string).then((v)=>{
            resolve(v)
          })
          break;
        }
        case ClashRpcType.getCountryCode: {
          getCountryCode(data[0] as string).then((v)=>{
            resolve(v)
          })
        }
        case ClashRpcType.load:{
          const parms = JSON.parse(data[0] as string) as UpdateConfigParams
          // 兼容clashMeta的路径
          parms['profile-id'] =  parms['profile-id'] + "/config"
          updateConfig(JSON.stringify(parms)).then(e=>{
            resolve(e)
          })
          break;
        }
        case ClashRpcType.reset:{
          forceGc()
          resolve(true)
          break;
        }
        case ClashRpcType.startClash: {
          this.startTun().then((r)=>{
            resolve(r)
          }).catch((e:Error)=>{
            reject(e)
          })
          break;
        }
        case ClashRpcType.stopClash:{
          this.stopVpn()
          resolve(true)
          break;
        }
      }
    })
  }

  ParseConfig(): VpnConfig {
    let vpnConfig = new VpnConfig();
    let option = JSON.parse(getVpnOptions()) as VpnOptions
    console.debug("ParseConfig", JSON.stringify(option))
    if (option.ipv4Address != "") {
      vpnConfig.addresses[0].address = new Address(option.ipv4Address.split("/")[0], 1)
      option.routeAddress?.filter(a => isIpv4(a)).map(f=>f.split("/")[0])
    }
    if (option.ipv6Address != ""){
      vpnConfig.addresses[0].address = new Address(option.ipv6Address.split("/")[0], 2)
      option.routeAddress?.filter(a => isIpv6(a)).map(f=>f.split("/")[0])
    }
    let packageName = ""
    if(option.accessControl?.mode){
      if(option.accessControl?.mode == "AcceptSelected"){
        vpnConfig.trustedApplications = option.accessControl?.acceptList
      }else{
        vpnConfig.blockedApplications = option.accessControl?.rejectList
      }
    }
    if(option.systemProxy || option.allowBypass){
      // TODO ohos 不支持
      // not use option.bypassDomain option.port
    }
    console.debug("vpnConfig", JSON.stringify(vpnConfig))
    return vpnConfig;
  }
  async startTun(): Promise<boolean> {
    let config = this.ParseConfig();
    let tunFd = -1
    try {
      tunFd = await super.startVpn(config)
      if(tunFd > -1){
        startTun(tunFd, async (id: number, fd: number) => {
          await this.protect(fd)
          setFdMap(id)
        })
      }
      return true;
    } catch (error) {
      return false
    }
  }
  stopVpn(){
    stopTun()
    super.stopVpn()
  }
  override async init(){
    initClash(await getHome(this.context), "1.0.0")
  }
}