import { createApp, h, reactive } from "vue";
import { FluentIconText, FluentSvgIcon, FluentTheme } from "../../styles/fluent/dist/vue/index.js";
import "../../styles/fluent/dist/style.css";

const stroke = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="8" y="10" width="12" height="8" fill="none" stroke="currentColor" stroke-width="4"/></svg>';
const state = reactive({svg:stroke,trim:true,optical:true,background:undefined as string|undefined,surface:"#fff",image:"none",foreground:"#111",label:"Play",fontSize:20,textSize:20,dir:"ltr",dark:false});
const events = {icon:0,text:0};
const measurements: Record<string, unknown> = {};
const errors: string[] = [];
Object.assign(window, {setGraphics:(value:Partial<typeof state>)=>Object.assign(state,value),graphicEvents:events,graphicMeasurements:measurements,graphicErrors:errors});
createApp({render:()=>h(FluentTheme,{mode:state.dark?"dark":"light"},()=>h("main",{style:{backgroundColor:state.surface,backgroundImage:state.image,color:state.foreground,font:`${state.fontSize}px/1.5 Arial`,padding:"48px"}},[
  h(FluentSvgIcon,{id:"named",svg:state.svg,size:24,trim:state.trim,optical:state.optical,background:state.background,label:"File",onReady:(value:unknown)=>{events.icon++;measurements.icon=value},onError:(error:Error)=>errors.push(error.message)}),
  h(FluentSvgIcon,{id:"decorative",svg:stroke,size:24,background:state.background}),
  h(FluentIconText,{id:"text",class:"state-color",svg:state.svg,size:state.textSize,trim:state.trim,optical:state.optical,background:state.background,dir:state.dir,onReady:(value:unknown)=>{events.text++;measurements.text=value},onError:(error:Error)=>errors.push(error.message)},()=>[state.label,h("span",{id:"baseline",style:"display:inline-block;width:0;height:0;vertical-align:baseline"})]),
]))}).mount("#app");
