#Requires AutoHotkey v2.0

/**
 * @class
 * @description
 * Resolves paths to the image assets.
 * The img folder lives beside the ahk folder, so every image path is built
 * here from the running script's location instead of being hard-coded at
 * each reference.
 */
class Assets {
    /**
     * @description
     * Absolute path of the folder that holds ahk, img and local.
     */
    static Root := Assets.__ResolveRoot()

    /**
     * @description
     * Absolute path of the img folder.
     */
    static Dir := Assets.Root "\img"

    /**
     * @description
     * Builds the absolute path of a file inside the img folder.
     * @param {(String)} Relative
     * Path relative to the img folder, e.g. `icon.ico` or `chrome\layer.png`.
     * @returns {(String)} The absolute path to the file.
     */
    static Path(Relative) {
        return Assets.Dir "\" StrReplace(Relative, "/", "\")
    }

    /**
     * @description
     * The folder of an icon set: `local\img\<name>` when it holds a `layer.png`, else `img\<name>`.
     * @param {(String)} Name
     * The icon set's name.
     * @returns {(String)} The absolute path to the folder.
     */
    static IconSetDir(Name) {
        personal := Assets.Root "\local\img\" Name
        if (FileExist(personal "\layer.png")) {
            return personal
        }
        return Assets.Dir "\" Name
    }

    static __ResolveRoot() {
        SplitPath(A_ScriptDir, , &parent)
        return parent
    }
}
