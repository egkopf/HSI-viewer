import React, { createContext, useContext, useState, useCallback } from 'react';

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

  const addSpectralData = useCallback((spectralData) => {
    setSharedSpectralData(prev => [...prev, spectralData]);
    setShowSharedSpectralGraph(true);
  }, []);

  const removeSpectralData = useCallback((index) => {
    setSharedSpectralData(prev => {
      const newArray = [...prev];
      newArray.splice(index, 1);
      if (newArray.length === 0) {
        setShowSharedSpectralGraph(false);
      }
      return newArray;
    });
  }, []);

  const clearAllSpectralData = useCallback(() => {
    setSharedSpectralData([]);
    setShowSharedSpectralGraph(false);
  }, []);

  const updateSpectralData = useCallback((index, updates) => {
    setSharedSpectralData(prev => {
      const newArray = [...prev];
      newArray[index] = { ...newArray[index], ...updates };
      return newArray;
    });
  }, []);

  const contextValue = {
    sharedSpectralData,
    showSharedSpectralGraph,
    setShowSharedSpectralGraph,
    addSpectralData,
    removeSpectralData,
    clearAllSpectralData,
    updateSpectralData
  };

  return (
    <SharedSpectralContext.Provider value={contextValue}>
      {children}
    </SharedSpectralContext.Provider>
  );
};