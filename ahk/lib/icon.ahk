#Requires AutoHotkey v2.0

#Include assets.ahk

/**
 * @class
 * @description
 * Represents an icon with different states for a UI.
 * The set's folder is `local\img\<name>` when that holds a `layer.png`, else `img\<name>`.
 * A key of w x h units shows `<state>_<w>x<h>.png` when the set has it, else `<state>.png`.
 */
class Icon {
    /**
     * @description
     * Creates an Icon object with paths to the icon images.
     * @param {(String)} name
     * The name of the icon folder inside local\img\ or img\
     */
    __New(name) {
        this.dir := Assets.IconSetDir(name)
        this.layer := this.dir "\layer.png"
        this.macro := this.dir "\macro.png"
        this.selected := this.dir "\selected.png"
        this.selectedMacro := this.dir "\selected_macro.png"
        this.sizes := Map()
    }

    /**
     * @description
     * The four images for a key of the given size, each the sized file when the set has it.
     * @param {Key} Key
     * The key from the layout.
     * @returns {Object} An object with `layer`, `macro`, `selected` and `selectedMacro` paths.
     */
    Sized(Key) {
        size := Key.width "x" Key.height
        if (this.sizes.Has(size)) {
            return this.sizes[size]
        }
        files := {
            layer: this.__Pick("layer", size),
            macro: this.__Pick("macro", size),
            selected: this.__Pick("selected", size),
            selectedMacro: this.__Pick("selected_macro", size)
        }
        this.sizes[size] := files
        return files
    }

    __Pick(State, Size) {
        sized := this.dir "\" State "_" Size ".png"
        return FileExist(sized) ? sized : this.dir "\" State ".png"
    }
}
