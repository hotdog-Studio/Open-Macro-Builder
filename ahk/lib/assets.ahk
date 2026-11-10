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
     * Absolute path of the img folder.
     */
    static Dir := Assets.__ResolveDir()

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

    static __ResolveDir() {
        SplitPath(A_ScriptDir, , &parent)
        return parent "\img"
    }
}
