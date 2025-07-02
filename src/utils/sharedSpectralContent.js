import React, { createContext, useContext, useState } from 'react';

const SharedSpectralContext = createContext();

export const useSharedSpectral = () => {
  const context = useContext(SharedSpectralContext);
  if (!context) {
    throw new Error('useSharedSpectral must be used within SharedSpectralProvider');
  }
  return context;
};

export const SharedSpectralProvider = ({ children }) => {
  const [sharedSpectralData, setSharedSpectralData] = useState([]);
  const [showSharedSpectralGraph, setShowSharedSpectralGraph] = useState(false);

  const addSpectralData = (spectralData) => {
    setSharedSpectralData(prev => [...prev, spectralData]);
    setShowSharedSpectralGraph(true);
  };

  const removeSpectralData = (index) => {
    setSharedSpectralData(prev => {
      const newArray = [...prev];
      newArray.splice(index, 1);
      return newArray;
    });
    if (sharedSpectralData.length <= 1) {
      setShowSharedSpectralGraph(false);
    }
  };

  const clearAllSpectralData = () => {
    setSharedSpectralData([]);
    setShowSharedSpectralGraph(false);
  };

  const updateSpectralData = (index, updates) => {
    setSharedSpectralData(prev => {
      const newArray = [...prev];
      newArray[index] = { ...newArray[index], ...updates };
      return newArray;
    });
  };

  return (
    <SharedSpectralContext.Provider value={{
      sharedSpectralData,
      showSharedSpectralGraph,
      setShowSharedSpectralGraph,
      addSpectralData,
      removeSpectralData,
      clearAllSpectralData,
      updateSpectralData
    }}>
      {children}
    </SharedSpectralContext.Provider>
  );
};