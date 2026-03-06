import React from 'react';
import { appTheme } from './utils/ant-helpers';

const siderColors = {
  light: {
    background: '#EDF3F9',
    color: '#000000',
    borderColor: '1px solid #f0f0f0',
  },
  dark: {
    background: 'rgb(0, 21, 41)',
    color: '#ffffff',
    borderColor: 'rgb(0, 21, 41)',
  },
};

const contentColors = {
  light: {
    background: '#ffffff',
    color: '#000000',
  },
  dark: {
    background: '#5B5D66',
    color: '#ffffff',
  },
};

const footerColors = {
  light: {
    background: '#F5F7F9',
    color: '#000000',
  },
  dark: {
    background: '#C9CBD2',
    color: '#000',
  },
};

function contentStyle(customBackgroundColor?: string): React.CSSProperties {
  return {
    textAlign: 'center',
    paddingTop: '15px',
    minHeight: 120,
    lineHeight: '120px',
    color: contentColors[appTheme.value].color,
    backgroundColor: customBackgroundColor || contentColors[appTheme.value].background,
  };
}

function backgroundVideo(): React.CSSProperties {
  return {
    position: 'absolute',
      zIndex: 0,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover'
}
}
function backgroundImage(): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 0,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'grid',
  }
}
function getEmptyBackground(): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 0,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'grid',
  }
}
function backgroundImageDevice(): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 0,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: '0.8',
    objectFit: 'cover',
    display: 'grid',
  }
}

function backgroundIcons(): React.CSSProperties {
  return {
    zIndex: 10,
    opacity: 0.9,
    backgroundColor:' white',
    position:'absolute',
    width: '42px',
    objectFit: 'cover',
    display: 'grid',
  }
}



function siderStyle(): React.CSSProperties {
  return {
    paddingTop: '5px',
    textAlign: 'center',
    lineHeight: '120px',
    color: siderColors[appTheme.value].color,
    backgroundColor: siderColors[appTheme.value].background,
    borderRight: siderColors[appTheme.value].borderColor,
  };
}

function footerStyle(): React.CSSProperties {
  return {
    zIndex: 0,
    padding: '5px 5px',
    textAlign: 'center',
    width: '100%',
    color: footerColors[appTheme.value].color,
    backgroundColor:  'rgba(0,0,0,0.0)',
  };
}

function layoutStyle(): React.CSSProperties {
  return {
    borderRadius: 8,
    overflow: 'hidden',
    width: 'calc(100% - 8px)',
    maxWidth: 'calc(100% - 8px)',
    height: 'calc(100vh - 24px)',
    maxHeight: 'calc(100vh - 24px)',
  };
}

const menuStyle = { width: '100%', border: 'none' };

export { contentStyle, siderStyle, footerStyle, layoutStyle, menuStyle, backgroundImage, backgroundIcons, backgroundImageDevice, backgroundVideo, getEmptyBackground};

export const globalStyles = `
  @keyframes blink {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
  }

  .blink-text {
    animation: blink 2s infinite;
  }
`;
