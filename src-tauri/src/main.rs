// Windows would otherwise open a console window alongside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    writegood_lib::run()
}
