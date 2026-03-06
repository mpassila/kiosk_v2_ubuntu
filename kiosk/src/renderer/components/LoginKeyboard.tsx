import React, { forwardRef } from 'react';
import { Card } from 'antd';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

interface LoginKeyboardProps {
  layoutName: string;
  onChange: (input: string) => void;
  onKeyPress: (button: string) => void;
  numericOnly?: boolean; // Support numeric-only mode
  inModal?: boolean; // Support modal positioning
  compact?: boolean; // Smaller keys for landscape mode
  customLayout?: string; // JSON string from device settings (customKeyboardUser / customKeyboardPassword)
}

// Parse custom keyboard JSON layout into react-simple-keyboard format
// Input: '[["1","2","3"],["Q","W","E"],null,["A","B","C"]]'
// Output: { default: ["1 2 3", "Q W E", "{empty}", "A B C", "{bksp}"] }
const parseCustomLayout = (json: string): { default: string[] } | null => {
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return null;
    const lines = rows.map((row: string[] | null) => {
      if (row === null) return '{empty}';
      if (!Array.isArray(row)) return '{empty}';
      return row.join(' ');
    });
    // Always add a backspace row at the end
    lines.push('{bksp}');
    // Provide all layout variants so react-simple-keyboard never hits undefined
    return { default: lines, shift: lines, special: lines, lock: lines };
  } catch {
    return null;
  }
};

const LoginKeyboard = forwardRef<any, LoginKeyboardProps>(
  ({ layoutName, onChange, onKeyPress, numericOnly = false, inModal = false, compact = false, customLayout }, ref) => {
    // Parse custom layout if provided
    const parsedCustom = customLayout ? parseCustomLayout(customLayout) : null;

    // Define layouts based on mode
    const fullLayout = {
      default: [
        "1 2 3 4 5 6 7 8 9 0",
        "q w e r t y u i o p",
        "a s d f g h j k l {lock}",
        "z x c v b n m {shift} {bksp}",
        "{special} {space}"
      ],
      shift: [
        "1 2 3 4 5 6 7 8 9 0",
        "Q W E R T Y U I O P",
        'A S D F G H J K L {lock}',
        "Z X C V B N M {shift} {bksp}",
        "{special} {space}"
      ],
      special: [
        "! @ # $ % ^ & * ( )",
        "- _ = + [ ] { } | \\",
        "< > / ? : ; ' \" ` ~",
        ", . Ö Ä Å € {bksp}",
        "{abc} {space}"
      ]
    };

    const numericLayout = {
      default: [
        "1 2 3",
        "4 5 6",
        "7 8 9",
        "{shift} 0 _",
        "{bksp}"
      ],
      shift: [
        "! / #",
        "$ % ^",
        "& * (",
        "{shift} ) +",
        "{bksp}"
      ]
    };

    return (
      <>
        <Card
          variant="outlined"
          style={inModal ? {
            width: '100%',
            marginTop: '10px'
          } : {
            position: 'fixed',
            width: '100%',
            zIndex: 10,
            bottom: '5px'
          }}
          className="keyboard-wrapper"
        >
          <Keyboard
            keyboardRef={(r) => {
              if (typeof ref === 'function') {
                ref(r);
              } else if (ref) {
                (ref as any).current = r;
              }
            }}
            layoutName={parsedCustom ? 'default' : layoutName}
            onChange={onChange}
            onKeyPress={onKeyPress}
            theme={`hg-theme-default hg-layout-default ${compact ? 'keyboard-compact' : 'keyboard-large'}`}
            layout={parsedCustom || (numericOnly ? numericLayout : fullLayout)}
            display={{
              "{bksp}": "⌫",
              "{enter}": "↵",
              "{shift}": "⇧",
              "{tab}": "⇥",
              "{lock}": "⇪",
              "{space}": " ",
              "{special}": "#+=",
              "{abc}": "ABC"
            }}
          />
        </Card>
        <style>{`
          .keyboard-large .hg-button {
            height: 110px !important;
            font-size: 32px !important;
            min-width: 70px !important;
          }
          .keyboard-large .hg-row {
            margin-bottom: 12px !important;
          }
          .keyboard-large .hg-button[data-skbtn*="empty"],
          .keyboard-compact .hg-button[data-skbtn*="empty"] {
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .keyboard-compact .hg-button {
            height: 60px !important;
            font-size: 24px !important;
            min-width: 50px !important;
          }
          .keyboard-compact .hg-row {
            margin-bottom: 6px !important;
          }
        `}</style>
      </>
    );
  }
);

LoginKeyboard.displayName = 'LoginKeyboard';

export default LoginKeyboard;
