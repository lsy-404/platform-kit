export const MODEL_AUTH_ELEMENT_TAG = "model-auth-dialog";
import { defineCustomElement } from "vue";
import ModelAuthDialog from "./ModelAuthDialog.vue";
import cssText from "./style.css?inline";

export function registerModelAuthElement(tag = MODEL_AUTH_ELEMENT_TAG): void {
  if (!customElements.get(tag)) customElements.define(tag, defineCustomElement(ModelAuthDialog, { styles: [cssText] }));
}
