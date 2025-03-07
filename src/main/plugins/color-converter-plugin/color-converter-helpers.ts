import * as color from "color";
import { StringHelpers } from "../../../common/helpers/string-helpers";

export function isValidColorCode(value: string): boolean {
    value = StringHelpers.replaceWhitespace(value.trim(), "");
    try {
        color(value);
        return value.startsWith("#")
            || value.startsWith("rgb(")
            || value.startsWith("rgba(");
    } catch {
        return false;
    }
}
