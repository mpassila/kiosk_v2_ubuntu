import { RetweetOutlined } from "@ant-design/icons";
import { kioskConfig, SEBlue, sessionBackgroundImage, showBackgroundImage, sessionWelcomeBackgroundColor, sessionWelcomeBackgroundImage, sessionSpinnerStatus } from "../state/shared";
import Icon from "@ant-design/icons/lib/components/Icon";
import { Component } from "react"
import { useSignals } from "@preact/signals-react/runtime";
import * as style from '../App.styles';
const config = kioskConfig.value;

const spinnerStyles = `
  @-webkit-keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  @-moz-keyframes spin{0%{-moz-transform:rotate(0)}100%{-moz-transform:rotate(360deg)}}
  @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  .spinner{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1003;background:white;overflow:hidden}
  .spinner div:first-child{display:block;position:relative;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;border-radius:50%;box-shadow:0 6px 6px 0 rgb(255, 56, 56);transform:translate3d(0,0,0);animation:spin 2s linear infinite}
  .spinner div:first-child:after,.spinner div:first-child:before{content:'';position:absolute;border-radius:50%}
  .spinner div:first-child:before{top:10px;left:10px;right:10px;bottom:10px;box-shadow:0 6px 6px 0 ${sessionBackgroundImage.value ? SEBlue.value : 'white'};-webkit-animation:spin 3s linear infinite;animation:spin 3s linear infinite}
  .spinner div:first-child:after{top:30px;left:30px;right:30px;bottom:30px;box-shadow:0 6px 6px 0 rgb(74, 61, 255);animation:spin 1.5s linear infinite}
  .spinner-status-text{position:fixed;top:65%;left:50%;transform:translate(-50%, -50%);color:white;font-size:48px;font-weight:bold;text-align:center;z-index:1004;text-shadow:3px 3px 8px ${SEBlue.value}, -1px -1px 4px ${SEBlue.value};max-width:80%;padding:20px}
`;

function getBackgroundStyle() {
  // Priority 1: If welcome background image is set from device settings
  if (sessionWelcomeBackgroundImage.value && config.files[sessionWelcomeBackgroundImage.value]) {
    return {
      backgroundImage: `url(data:image/*;base64,${config.files[sessionWelcomeBackgroundImage.value]})`,
      backgroundColor: sessionWelcomeBackgroundColor.value || undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    };
  }

  // Priority 2: Welcome background color only (no image)
  if (sessionWelcomeBackgroundColor.value) {
    return {
      backgroundColor: sessionWelcomeBackgroundColor.value
    };
  }

  // Priority 3: Default blue background
  return {
    backgroundImage: `url(./Blue42A4DE.png)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  };
}

const Spinner = () => {
  useSignals();
  const statusText = sessionSpinnerStatus.value;

  return (
    <>
      <style>{spinnerStyles}</style>
      <div id="nb-global-spinner" className="spinner" style={getBackgroundStyle()}>
        <div className="blob blob-0"></div>
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
        <div className="blob blob-4"></div>
        <div className="blob blob-5"></div>
        {statusText && (
          <div className="spinner-status-text">{statusText}</div>
        )}
      </div>
      <RetweetOutlined style={{ opacity: 0.02, zIndex: 1004, fontSize: '64px', color: 'blue', position: 'fixed', top: '10px', left: '10px', }} onClick={() => {
        window.location.reload()
      }} />

    </>
  );
};

export default Spinner;
