#Requires AutoHotkey v2.0

#Include create_image_button.ahk
#Include assets.ahk
; *********************** Gui ********************************
/**
 * @class
 * @description
 * Represents the Layer Selection GUI for the macro pad.
 * Manages the display and interaction of layers and their associated macros.
 */
class LayerSelectGui {
   /**
    * @description
    * Initializes the LayerSelectGui with the provided layout.
    * Sets up the GUI window, buttons, and labels based on the layout configuration.
    * @param {Layout} Layout
    * The layout configuration for the GUI.
    */
   __New(Layout) {
      ; Variables
      this.__selectedLayer := 0

      fontColor := "cFEFEFE"
      transColor := "0x010101"

      this.layout := Layout

      ; UI Elements
      this.buttons := []
      this.labels := []

      ; Window
      ; +E0x08000000 is WS_EX_NOACTIVATE: a click on the overlay never takes the focus, as with the
      ; PowerShell overlay (OverlayForm in powershell\lib\Native.ps1). It still gets the mouse messages.
      this.window := Gui()
      this.window.Opt("-MinimizeBox -MaximizeBox -SysMenu +AlwaysOnTop -Caption +Owner -Parent +E0x08000000")
      this.window.Title := ""
      this.window.SetFont(fontColor " bold italic", "Consolas")
      this.window.BackColor := transColor
      WinSetTransColor(transColor, this.window)

      ; Add Layout Labels
      Loop Layout.keys.Length {
         this.labels.Push(this.window.AddText("r1 center x" Layout.keys[A_Index].label.x " y" Layout.keys[A_Index].label.y " w" Layout.keys[A_Index].label.w " h" Layout.keys[A_Index].label.h " Section -theme +0x8000 -0x1", layout.keys[A_Index].key))
      }

      ; Add Layout Buttons
      Loop Layout.keys.Length {
         this.buttons.Push(this.window.AddButton("x" Layout.keys[A_Index].x " y" Layout.keys[A_Index].y " w" Layout.keys[A_Index].w " h" Layout.keys[A_Index].h " disabled"))
      }

      ; Initialize icons
      for (i, button in this.buttons) {
         Layout.InitializeIcon(i, button)
      }

      ; Select the first non-blank layer
      if (Layout.default >= 1 && Layout.default <= Layout.layers.Length && Layout.layers[Layout.default]) {
         this.SelectLayer(Layout.default)
      }
      else {
         for (i, layer in Layout.layers) {
            if (!layer) {
               continue
            } else {
               this.SelectLayer(i)
               break
            }
         }
      }

      if (Layout.showFn) {
         ; Show the function key label
         text := this.window.AddText("r1 center x" Layout.fn.label.x " y" Layout.fn.label.y " w" Layout.fn.label.w " h" Layout.fn.label.h " Section", Layout.showFn)

         if (Layout.showFn != " ") {
            text.Opt(" +Background101010")
            text.Redraw()
         }

         ; Show the function key button
         fnButton := this.window.AddButton("x" Layout.fn.x " y" Layout.fn.y " w" Layout.fn.w " h" Layout.fn.h " disabled")
         icon := LayerSelectGui.GetEmptyIcon(Layout.fn)
         CreateImageButton(fnButton, 0, [icon, , , 32], [icon, , , 32])
      }
   }

   /**
    * @description
    * Returns the currently selected layer index.
    * @returns {number}
    * The index of the selected layer.
    */
   GetSelectedLayer() {
      return this.__selectedLayer
   }

   /**
    * @description
    * Selects a layer by its index and updates the GUI accordingly.
    * If no layer is found, the function exits without making changes.
    * @param {number} Value
    * The index of the layer to select.
    */
   SelectLayer(Value) {
      ; Validate input
      if (Value < 1 || Value > this.layout.layers.Length || !this.layout.layers[Value]) {
         return
      }

      ; If there was a previously selected layer, update its icon
      if (this.__selectedLayer) {
         this.layout.SetPreviousLayerIcon(this.__selectedLayer, Value, this.buttons[this.__selectedLayer])
      }

      ; Update labels and icons for the new selected layer
      this.layout.SetNextLayerIcon(Value, this.buttons[Value])

      ; Update label texts
      this.layout.SetNextLayerLabels(Value, this.labels)

      ; Update button icons
      this.layout.SetLayerIcons(this.__selectedLayer, Value, this.buttons)

      this.__selectedLayer := Value
   }

   /**
    * @description
    * Shows the GUI window without activating it, so the window that has the focus keeps it
    * (the PowerShell overlay is shown the same way).
    */
   Show() {
      this.window.Show("NA")
   }

   /**
    * @description
    * Hides the GUI window.
    */
   Hide() {
      this.window.Hide()
   }

   /**
    * @description
    * Returns the appropriate empty icon path based on key dimensions.
    * @param {Key} Key
    * The key from the layout.
    * @returns {string}
    * The file path of the empty icon.
    */
   static GetEmptyIcon(Key) {
      sized := Assets.Path("empty_" Key.width "x" Key.height ".png")
      return FileExist(sized) ? sized : Assets.Path("empty.png")
   }

   static GetBlankIcon() {
      return Assets.Path("blank.png")
   }
}
