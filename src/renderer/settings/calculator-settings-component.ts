import Vue from "vue";
import { vueEventDispatcher } from "../vue-event-dispatcher";
import { VueEventChannels } from "../vue-event-channels";
import { PluginSettings } from "./plugin-settings";
import { UserConfigOptions } from "../../common/config/user-config-options";
import { defaultCalculatorOptions } from "../../common/config/default-calculator-options";
import { cloneDeep } from "lodash";
import { TranslationSet } from "../../common/translation/translation-set";
import { UserConfirmationDialogParams, UserConfirmationDialogType } from "./modals/user-confirmation-dialog-params";

export const calculatorSettingsComponent = Vue.extend({
    data() {
        return {
            settingName: PluginSettings.Calculator,
            visible: false,
        };
    },
    methods: {
        toggleEnabled() {
            const config: UserConfigOptions = this.config;
            config.calculatorOptions.isEnabled = !config.calculatorOptions.isEnabled;
            this.updateConfig();
        },
        resetAll() {
            const translations: TranslationSet = this.translations;
            const userConfirmationDialogParams: UserConfirmationDialogParams = {
                callback: () => {
                    const config: UserConfigOptions = this.config;
                    config.calculatorOptions = cloneDeep(defaultCalculatorOptions);
                    this.updateConfig();
                },
                message: translations.resetPluginSettingsToDefaultWarning,
                modalTitle: translations.resetToDefault,
                type: UserConfirmationDialogType.Default,
            };
            vueEventDispatcher.$emit(VueEventChannels.settingsConfirmation, userConfirmationDialogParams);
        },
        updateConfig() {
            vueEventDispatcher.$emit(VueEventChannels.configUpdated, this.config);
        },
    },
    mounted() {
        vueEventDispatcher.$on(VueEventChannels.showSetting, (settingName: string) => {
            if (settingName === this.settingName) {
                this.visible = true;
            } else {
                this.visible = false;
            }
        });
    },
    props: ["config", "translations"],
    template: `
    <div v-if="visible">
        <div class="settings__setting-title title is-3">
            <span>
                {{ translations.calcuator }}
            </span>
            <div>
                <button class="button" :class="{ 'is-success' : config.calculatorOptions.isEnabled }" @click="toggleEnabled">
                    <span class="icon"><i class="fas fa-power-off"></i></span>
                </button>
                <button v-if="config.calculatorOptions.isEnabled" class="button" @click="resetAll">
                    <span class="icon"><i class="fas fa-undo-alt"></i></span>
                </button>
            </div>
        </div>
        <p class="settings__setting-description" v-html="translations.calculatorDescription"></p>
        <div class="settings__setting-content">
            <div v-if="!config.calculatorOptions.isEnabled" class="settings__setting-disabled-overlay"></div>
                <div class="box">
                    <div class="settings__option-container">

                        <div class="settings__option">
                            <div class="settings__option-name">{{ translations.calculatorPrecision }}</div>
                            <div class="settings__option-content">
                                <div class="field is-grouped is-grouped-right">
                                    <div class="control">
                                        <input
                                            type="number"
                                            class="input"
                                            min="1"
                                            v-model="config.calculatorOptions.precision"
                                            @change="updateConfig"
                                        >
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    </div>
    `,
});
