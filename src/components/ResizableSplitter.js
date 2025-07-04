import React, { useState, useRef, useCallback, useEffect } from 'react';

const ResizableSplitter = ({ children, defaultLeftWidth = 50, minWidth = 20 }) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const startX = useRef(0);
  const startLeftWidth = useRef(leftWidth);

  const handleMouseDown = useCallback((e) => {
    setIsDragging(true);
    startX.current = e.clientX;
    startLeftWidth.current = leftWidth;
    e.preventDefault();
  }, [leftWidth]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - startX.current;
    const deltaPercentage = (deltaX / containerRect.width) * 100;
    const newLeftWidth = Math.max(
      minWidth,
      Math.min(100 - minWidth, startLeftWidth.current + deltaPercentage)
    );

    setLeftWidth(newLeftWidth);
  }, [isDragging, minWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Handle case where there are not exactly 2 children
  if (!children || children.length !== 2) {
    return <div className="h-full">{children}</div>;
  }

  const [leftChild, rightChild] = children;

  return (
    <div 
      ref={containerRef} 
      className="flex h-full relative"
    >
      {/* Left Panel */}
      <div 
        className="flex flex-col min-h-0"
        style={{ width: `${leftWidth}%` }}
      >
        {leftChild}
      </div>

      {/* Splitter */}
      <div 
        className="w-1 flex-shrink-0 relative flex items-center justify-center cursor-col-resize"
        onMouseDown={handleMouseDown}
      >
        {/* Two small vertical lines */}
        <div className="flex items-center gap-px">
          <div className={`w-px h-8 transition-colors duration-200 ${
            isDragging ? 'bg-blue-500' : 'bg-gray-600 hover:bg-blue-400'
          }`} />
          <div className={`w-px h-8 transition-colors duration-200 ${
            isDragging ? 'bg-blue-500' : 'bg-gray-600 hover:bg-blue-400'
          }`} />
        </div>
      </div>

      {/* Right Panel */}
      <div 
        className="flex flex-col min-h-0 flex-1"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {rightChild}
      </div>
    </div>
  );
};

export default ResizableSplitter;