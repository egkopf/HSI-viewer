import React, { useState } from 'react';

const FileStructureTree = ({ structure, onDatasetSelect, selectedWavelength, selectedReflectance }) => {
  const [expandedNodes, setExpandedNodes] = useState(new Set(['root']));

  const toggleNode = (path) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  const renderNode = (node, level = 0) => {
    const isExpanded = expandedNodes.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    const isSelectable = node.type === 'dataset' || node.type === 'variable';
    const isWavelengthSelected = selectedWavelength === node.path;
    const isReflectanceSelected = selectedReflectance === node.path;

    return (
      <div key={node.path} style={{ marginLeft: level * 20 }}>
        <div className="flex items-center py-1 hover:bg-gray-100 rounded">
          {/* Expand/Collapse Icon */}
          {hasChildren && (
            <button
              onClick={() => toggleNode(node.path)}
              className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-700 mr-1"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          
          {/* Node Icon */}
          <span className="w-4 h-4 flex items-center justify-center mr-2">
            {getNodeIcon(node)}
          </span>
          
          {/* Node Name */}
          <span className="flex-1 text-sm">
            {node.name}
          </span>
          
          {/* Candidate Badges */}
          {node.isWavelengthCandidate && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded ml-2">
              Wavelength?
            </span>
          )}
          {node.isReflectanceCandidate && (
            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded ml-2">
              Reflectance?
            </span>
          )}
          
          {/* Selection Buttons */}
          {isSelectable && (
            <div className="flex gap-1 ml-2">
              <button
                onClick={() => onDatasetSelect(node.path, 'wavelength')}
                className={`px-2 py-1 text-xs rounded ${
                  isWavelengthSelected 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }`}
                title="Select as wavelength data"
              >
                λ
              </button>
              <button
                onClick={() => onDatasetSelect(node.path, 'reflectance')}
                className={`px-2 py-1 text-xs rounded ${
                  isReflectanceSelected 
                    ? 'bg-green-500 text-white' 
                    : 'bg-green-100 text-green-800 hover:bg-green-200'
                }`}
                title="Select as reflectance data"
              >
                R
              </button>
            </div>
          )}
        </div>
        
        {/* Node Details */}
        {isSelectable && (
          <div className="ml-6 text-xs text-gray-600">
            {node.shape && (
              <span>Shape: [{node.shape.join(', ')}] </span>
            )}
            {node.size && (
              <span>Size: {node.size.toLocaleString()} </span>
            )}
            {node.dataType && (
              <span>Type: {node.dataType} </span>
            )}
            {node.dataNotLoaded && (
              <span className="text-yellow-600">(metadata only) </span>
            )}
          </div>
        )}
        
        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const getNodeIcon = (node) => {
    switch (node.type) {
      case 'hdf5':
      case 'netcdf':
        return '📁';
      case 'group':
        return '📂';
      case 'dataset':
      case 'variable':
        return '📊';
      case 'attributes':
        return '📋';
      case 'dimensions':
        return '📏';
      case 'attribute':
        return '🏷️';
      case 'dimension':
        return '📐';
      case 'error':
        return '❌';
      case 'unknown':
        return '❓';
      default:
        return '📄';
    }
  };

  if (!structure) {
    return <div className="p-4 text-gray-500">No file structure available</div>;
  }

  return (
    <div className="p-4 bg-white border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">File Structure</h3>
      
      {/* Large file notification */}
      {structure.isLargeFile && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="text-sm text-yellow-800">
            <strong>Large File Mode:</strong> Showing metadata only for {(structure.fileSize / 1024 / 1024 / 1024).toFixed(1)}GB file.
            {structure.headerSize && (
              <div className="mt-1">
                Used {(structure.headerSize / 1024 / 1024).toFixed(1)}MB of header data for structure analysis.
              </div>
            )}
            <div className="mt-1">
              Data will be loaded only when you select and process datasets.
            </div>
          </div>
        </div>
      )}
      
      <div className="text-sm">
        <div className="mb-2 text-xs text-gray-600">
          Select datasets for wavelength (λ) and reflectance (R) data:
        </div>
        {renderNode(structure)}
      </div>
    </div>
  );
};

export default FileStructureTree;