import { emitter } from "@kit.BasicServicesKit";

export enum EventKey{
  FetchProxyGroup = 10000,
  FetchProfile = 10001
}

export class EventHub{
  static sendEvent(key: EventKey, data: any = null){
    emitter.emit({eventId: key}, {data: data})
  }
  static on(key: EventKey, callback: (data: any)=>void){
    emitter.on({eventId: key},(data)=>{
      callback(data.data)
    })
  }
}