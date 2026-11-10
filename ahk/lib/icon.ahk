#Requires AutoHotkey v2.0

#Include assets.ahk

/**
 * @class
 * @description
 * Represents an icon with different states for a UI.
 */
class Icon {
    /**
     * @description
     * Creates an Icon object with paths to the icon images.
     * @param {(String)} name
     * The name of the icon folder inside img/ 
     */
    __New(name) {
        this.layer := Assets.Path(name "\layer.png")
        this.macro := Assets.Path(name "\macro.png")
        this.selected := Assets.Path(name "\selected.png")
        this.selectedMacro := Assets.Path(name "\selected_macro.png")
    }
}
