import { defineComponent, h, ref } from "vue";
import { FluentButton, FluentCheckbox, FluentIconText, FluentSvgIcon } from "@platform-kit/fluent/vue";

const play = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="currentColor" d="M8 6L26 16L8 26Z"/></svg>';
const twoTone = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="8" width="8" height="16" fill="black"/><rect x="19" y="8" width="8" height="16" fill="white"/></svg>';
const stroke = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect x="14" y="8" width="20" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="4"/></svg>';

export const GraphicsPreview = defineComponent({
  setup() {
    const trim = ref(true), optical = ref(true), rtl = ref(false);
    return () => h("section", {id:"graphics",class:"catalog-section"}, [
      h("h2", "SVG alignment and icon labels"),
      h("div", {class:"control-row"}, [
        h(FluentCheckbox,{modelValue:trim.value,label:"Trim transparent space","onUpdate:modelValue":(value:boolean)=>trim.value=value}),
        h(FluentCheckbox,{modelValue:optical.value,label:"Visual center estimate","onUpdate:modelValue":(value:boolean)=>optical.value=value}),
        h(FluentCheckbox,{modelValue:rtl.value,label:"Right-to-left","onUpdate:modelValue":(value:boolean)=>rtl.value=value}),
      ]),
      h("div", {class:"graphics-comparison",dir:rtl.value?"rtl":"ltr"}, [
        h("div", [h("p", "Original viewport"),h("div",{class:"graphics-target"},[h(FluentSvgIcon,{svg:play,size:48,trim:false,optical:false,label:"Original triangle"})])]),
        h("div", [h("p", "Fluent SVG icon"),h("div",{class:"graphics-target"},[h(FluentSvgIcon,{svg:play,size:48,trim:trim.value,optical:optical.value,label:"Aligned triangle","data-testid":"visual-center-preview"})])]),
        h("div", [h("p", "Stroke remains intact"),h("div",{class:"graphics-target"},[h(FluentSvgIcon,{svg:stroke,size:48,trim:trim.value,optical:optical.value,label:"Outlined shape"})])]),
        h("div", [h("p", "Two colors"),h("div",{class:"graphics-target"},[h(FluentSvgIcon,{svg:twoTone,size:48,trim:trim.value,optical:optical.value,label:"Color-weighted center"})])]),
      ]),
      h("div", {class:"control-row",dir:rtl.value?"rtl":"ltr"}, ["Play", "播放", "gyp"].map(label => h(FluentButton, {tone:"secondary"}, () => h(FluentIconText, {svg:play,size:18,trim:trim.value,optical:optical.value}, () => label)))),
      h("p", {class:"graphics-note"}, "The correction is a color-weighted estimate. Compare it with the original at the size and background where it will be used."),
    ]);
  },
});
