import React, { useState, useCallback, useMemo, memo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { openDB } from 'idb';
import './MergeTool.scss';

interface Variable {
  name: string;
  description: string;
  fieldType?: string;
  choices?: string;
  formName?: string;
}

interface VariablePair {
  db1: string;
  db2: string;
}

interface VariableListProps {
  title: string;
  data: Variable[];
  selected?: string;
  onSelect: (name: string) => void;
  pairedVariables: Set<string>;
  pairMap: Map<string, string>;
}

interface DropZoneProps {
  onDrop: (files: File[]) => void;
  label: string;
  loadedFileName?: string;
}

interface CSVRow {
  'Variable / Field Name'?: string;
  'variable_name'?: string;
  'Field Label'?: string;
  'field_label'?: string;
  'Field Type'?: string;
  'field_type'?: string;
  'Choices, Calculations, OR Slider Labels'?: string;
  'choices'?: string;
  'Form Name'?: string;
  'form_name'?: string;
  [key: string]: string | undefined;
}

const ITEM_SIZE = 90; // Match the height in SCSS

interface AutoSizerProps {
  height: number;
  width: number;
}

const VariableItem = memo(({ 
  data: { 
    item,
    selected,
    isPaired,
    pairedWith,
    onSelect
  }
}: {
  data: {
    item: Variable;
    selected: boolean;
    isPaired: boolean;
    pairedWith: string | undefined;
    onSelect: (name: string) => void;
  }
}) => {
  const itemClasses = [
    'variable-list__item',
    selected ? 'variable-list__item--selected' : '',
    isPaired ? 'variable-list__item--paired' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      onClick={() => !isPaired && onSelect(item.name)}
      className={itemClasses}
    >
      <div className="variable-list__item-header">
        <div className="variable-list__item-name">
          {item.name}
          {item.formName && (
            <span className="variable-list__item-form-name">
              {item.formName}
            </span>
          )}
        </div>
        {isPaired && pairedWith && (
          <span className="variable-list__item-paired-badge" title={`Paired with: ${pairedWith}`}>
            ↔ {pairedWith}
          </span>
        )}
      </div>
      <div className="variable-list__item-description">{item.description}</div>
      <div className="variable-list__item-meta">
        <span>Type: {item.fieldType}</span>
        {item.choices && (
          <span className="truncate">
            Choices: {item.choices.substring(0, 100)}
            {item.choices.length > 100 && '...'}
          </span>
        )}
      </div>
    </div>
  );
});

VariableItem.displayName = 'VariableItem';

const VariableRow = memo(({ 
  index, 
  style, 
  data: { 
    items,
    selected,
    pairedVariables,
    pairMap,
    onSelect
  } 
}: {
  index: number;
  style: React.CSSProperties;
  data: {
    items: Variable[];
    selected?: string;
    pairedVariables: Set<string>;
    pairMap: Map<string, string>;
    onSelect: (name: string) => void;
  }
}) => {
  const item = items[index];
  const isPaired = pairedVariables.has(item.name);
  const pairedWith = pairMap.get(item.name);

  return (
    <div style={style}>
      <VariableItem
        data={{
          item,
          selected: selected === item.name,
          isPaired,
          pairedWith,
          onSelect
        }}
      />
    </div>
  );
});

VariableRow.displayName = 'VariableRow';

const VariableList: React.FC<VariableListProps> = memo(({
  title,
  data,
  selected,
  onSelect,
  pairedVariables,
  pairMap,
}) => {
  const listData = useMemo(() => ({
    items: data,
    selected,
    pairedVariables,
    pairMap,
    onSelect
  }), [data, selected, pairedVariables, pairMap, onSelect]);

  return (
    <div className="variable-list">
      <div className="variable-list__header">
        <h3 className="variable-list__header-title">{title}</h3>
        <span className="variable-list__header-count">
          {data.length - pairedVariables.size} / {data.length} available
        </span>
      </div>
      <div className="variable-list__content">
        {data.length === 0 ? (
          <div className="variable-list__empty">
            No variables loaded yet
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }: AutoSizerProps) => (
              <List
                height={height}
                width={width}
                itemCount={data.length}
                itemSize={ITEM_SIZE}
                itemData={listData}
              >
                {VariableRow}
              </List>
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
});

VariableList.displayName = 'VariableList';

const DropZone = memo(({ onDrop, label, loadedFileName }: DropZoneProps) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      className={`dropzone ${isDragActive ? 'dropzone--active' : ''} ${loadedFileName ? 'dropzone--has-file' : ''}`}
    >
      <input {...getInputProps()} />
      <p className="dropzone__label">{label}</p>
      {loadedFileName ? (
        <p className="dropzone__file-name" title={loadedFileName}>
          {loadedFileName}
        </p>
      ) : (
        <p className="dropzone__hint">
          {isDragActive ? 'Drop the file here' : 'Drag & Drop or Click to Upload'}
        </p>
      )}
    </div>
  );
});

DropZone.displayName = 'DropZone';

// Add before MergeTool component
const DB_NAME = 'redcap-merger';
const STORE_NAME = 'merger-data';
const DATA_KEY = 'stored-data';

interface StoredData {
  db1: Variable[];
  db2: Variable[];
  pairs: VariablePair[];
}

const initializeDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME);
    },
  });
};

const MergeTool: React.FC = () => {
  const [db1, setDb1] = useState<Variable[]>([]);
  const [db2, setDb2] = useState<Variable[]>([]);
  const [pairs, setPairs] = useState<VariablePair[]>([]);
  const [selected, setSelected] = useState<{ db1?: string; db2?: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadedFiles, setLoadedFiles] = useState<{ db1?: string; db2?: string }>({});

  // Load stored data on component mount
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const db = await initializeDB();
        const data = await db.get(STORE_NAME, DATA_KEY) as StoredData | undefined;
        
        if (data) {
          setDb1(data.db1);
          setDb2(data.db2);
          setPairs(data.pairs);
        }
      } catch (error) {
        console.error('Error loading stored data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadStoredData();
  }, []);

  // Save data whenever it changes
  useEffect(() => {
    if (isLoading) return; // Skip initial load

    const saveData = async () => {
      try {
        const db = await initializeDB();
        await db.put(STORE_NAME, {
          db1,
          db2,
          pairs,
        }, DATA_KEY);
      } catch (error) {
        console.error('Error saving data:', error);
      }
    };

    saveData();
  }, [db1, db2, pairs, isLoading]);

  const pairedVariablesDb1 = new Set(pairs.map(p => p.db1));
  const pairedVariablesDb2 = new Set(pairs.map(p => p.db2));

  // Create a map of variable names to their paired variables
  const pairMap = pairs.reduce((acc, pair) => {
    acc.set(pair.db1, pair.db2);
    acc.set(pair.db2, pair.db1);
    return acc;
  }, new Map<string, string>());

  const processCSV = useCallback((file: File, setDb: React.Dispatch<React.SetStateAction<Variable[]>>, dbKey: 'db1' | 'db2') => {
    const reader = new FileReader();
    reader.onload = ({ target }) => {
      const csv = target?.result;
      if (typeof csv === 'string') {
        const parsed = Papa.parse<CSVRow>(csv, { header: true });
        const data = parsed.data
          .filter(row => row['Variable / Field Name'] || row['variable_name'])
          .map(row => ({
            name: row['Variable / Field Name'] || row['variable_name'] || '',
            description: row['Field Label'] || row['field_label'] || '',
            fieldType: row['Field Type'] || row['field_type'] || '',
            choices: row['Choices, Calculations, OR Slider Labels'] || row['choices'] || '',
            formName: row['Form Name'] || row['form_name'] || '',
          }));
        setDb(data);
        setLoadedFiles(prev => ({ ...prev, [dbKey]: file.name }));
      }
    };
    reader.readAsText(file);
  }, []);

  const handleSelect = useCallback((type: 'db1' | 'db2', name: string) => {
    // If the variable is already paired, don't allow selection
    if ((type === 'db1' && pairedVariablesDb1.has(name)) ||
        (type === 'db2' && pairedVariablesDb2.has(name))) {
      return;
    }

    setSelected(prev => {
      const newSelected = { ...prev, [type]: name };
      
      // If both variables are selected
      if (newSelected.db1 && newSelected.db2) {
        // Check if either variable is already paired
        if (pairedVariablesDb1.has(newSelected.db1) || 
            pairedVariablesDb2.has(newSelected.db2)) {
          return {};
        }

        // Create the pair
        const newPair: VariablePair = {
          db1: newSelected.db1,
          db2: newSelected.db2
        };

        // Only add if this pair doesn't exist yet
        setPairs(prev => {
          const pairExists = prev.some(p => 
            (p.db1 === newPair.db1 && p.db2 === newPair.db2)
          );
          return pairExists ? prev : [...prev, newPair];
        });
        
        // Always reset selection after attempting to create a pair
        return {};
      }
      
      return newSelected;
    });
  }, [pairedVariablesDb1, pairedVariablesDb2]);

  const handleExport = useCallback(() => {
    const csvContent = 
      'db1_variable,db2_variable\n' +
      pairs.map(p => `${p.db1},${p.db2}`).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'variable_merge_map.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [pairs]);

  const removePair = useCallback((index: number) => {
    setPairs(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="merger-tool">
      <div className="merger-tool__main">
        <h1 className="merger-tool__main-title">REDCap Variable Merger</h1>
        
        <div className="merger-tool__content">
          <div className="merger-tool__database">
            <h2 className="merger-tool__database-title">Database Dictionary #1</h2>
            <DropZone
              onDrop={files => processCSV(files[0], setDb1, 'db1')}
              label="Drop Database 1 CSV"
              loadedFileName={loadedFiles.db1}
            />
            <VariableList
              title="Variables"
              data={db1}
              selected={selected.db1}
              onSelect={(name) => handleSelect('db1', name)}
              pairedVariables={pairedVariablesDb1}
              pairMap={pairMap}
            />
          </div>

          <div className="merger-tool__database">
            <h2 className="merger-tool__database-title">Database Dictionary #2</h2>
            <DropZone
              onDrop={files => processCSV(files[0], setDb2, 'db2')}
              label="Drop Database 2 CSV"
              loadedFileName={loadedFiles.db2}
            />
            <VariableList
              title="Variables"
              data={db2}
              selected={selected.db2}
              onSelect={(name) => handleSelect('db2', name)}
              pairedVariables={pairedVariablesDb2}
              pairMap={pairMap}
            />
          </div>
        </div>
      </div>

      <div className="merger-tool__sidebar">
        <div className="matched-pairs">
          <div className="matched-pairs__header">
            <h2 className="matched-pairs__header-title">Matched Variable Pairs</h2>
            <p className="matched-pairs__header-count">
              {pairs.length} pair{pairs.length !== 1 ? 's' : ''} matched
            </p>
            <button
              onClick={handleExport}
              className="matched-pairs__header-export"
              disabled={pairs.length === 0}
            >
              Export Mapping
            </button>
          </div>
          
          <div className="matched-pairs__list">
            {pairs.length === 0 ? (
              <div className="matched-pairs__empty">
                <p className="matched-pairs__empty-title">No pairs matched yet</p>
                <p className="matched-pairs__empty-hint">
                  Click a variable from each database to create a pair
                </p>
              </div>
            ) : (
              pairs.map((pair, idx) => (
                <div key={idx} className="matched-pairs__item">
                  <div className="matched-pairs__item-content">
                    <span className="matched-pairs__item-variable">{pair.db1}</span>
                    <svg className="matched-pairs__item-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <span className="matched-pairs__item-variable">{pair.db2}</span>
                  </div>
                  <button
                    onClick={() => removePair(idx)}
                    className="matched-pairs__item-remove"
                    title="Remove pair"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(MergeTool); 