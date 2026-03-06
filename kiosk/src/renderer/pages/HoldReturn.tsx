import React, { useEffect, useState, CSSProperties } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { updateLocation } from 'renderer/state/shared';

export default function HoldReturnPage() {
  useSignals();
  useEffect(() => {
    updateLocation('/holdreturn')
  }, []);


  return <div>HoldReturn</div>;


}

