import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { Person } from '../types/types';
import {
  getFormattedName,
  getFormattedDateAndAge,
  getPhotoUrl,
  FALLBACK_SILHOUETTE,
} from '../utils/helper';
import '../styles/GenealogyPage.css';

interface Props {
  persons: Person[];
}

const FOCUS_DIMMED_OPACITY = 0.5;

const CARD_WIDTH = 190;
const CARD_HEIGHT = 72;
const PHOTO_DIAMETER = 42;
const SPOUSE_GAP = 240; 
const UNIT_GAP = 60;
const LEVEL_HEIGHT = 180;

function emptyPerson(id: string): Person {
  return {
    id, nomNaissance: '', prenom: id, autresPrenoms: '',
    dateNaissance: '', jourMoisNaissance: '', dateDeces: '',
    mere: '', pere: '', conjoint: '', sexe: '', maison: '',
  };
}

export default function GenealogyPage({ persons }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.8 });
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ x: 0, y: 0, tx: 0, ty: 0, moved: false });

  const personMap = useMemo(() => new Map(persons.map(p => [p.id, p])), [persons]);
  
  const findOrEmpty = (id: string) => persons.find((p) => p.id === id) || emptyPerson(id);

  // --- FONCTION DE FORMATAGE DU NOM (AVEC GESTION NOM DE MARIAGE) ---
  const getDisplayName = (p: Person): string => {
    if (!p) return '';
    const isFemale = p.sexe?.toUpperCase() === 'F';
    const spouse = p.conjoint ? personMap.get(p.conjoint) : undefined;

    if (isFemale && spouse) {
      const husbandNom = spouse.nomNaissance;
      const birthName = p.nomNaissance;

      if (husbandNom) {
        return `${p.prenom} ${husbandNom}${birthName ? ` née ${birthName}` : ''}`;
      }
    }

    return getFormattedName(p);
  };

  // --- OBTENTION DES ENFANTS DE LA PERSONNE SÉLECTIONNÉE ---
  const selectedPersonChildren = useMemo(() => {
    if (!selectedPerson) return [];
    return persons.filter(p => p.mere === selectedPerson.id || p.pere === selectedPerson.id);
  }, [selectedPerson, persons]);

  // --- IDENTIFICATION DE L'ARBRE VISUEL ---
  const closeFamily = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedPerson) return ids;
    const pId = selectedPerson.id;
    ids.add(pId);
    
    if (selectedPerson.conjoint) ids.add(selectedPerson.conjoint);
    if (selectedPerson.mere) ids.add(selectedPerson.mere);
    if (selectedPerson.pere) ids.add(selectedPerson.pere);

    let hasGrandChildren = false;

    const children = persons.filter(c => c.mere === pId || c.pere === pId);
    children.forEach(c => {
      ids.add(c.id);
      
      const grandChildren = persons.filter(gc => gc.mere === c.id || gc.pere === c.id);
      if (grandChildren.length > 0) {
        hasGrandChildren = true;
      }
      
      grandChildren.forEach(gc => ids.add(gc.id));
    });

    if (!hasGrandChildren) {
      persons.forEach(other => {
        if (other.id !== pId && 
           ((selectedPerson.mere && (other.mere === selectedPerson.mere || other.pere === selectedPerson.mere)) ||
            (selectedPerson.pere && (other.mere === selectedPerson.pere || other.pere === selectedPerson.pere)))) {
            ids.add(other.id);
        }
      });
    }

    return ids;
  }, [selectedPerson, persons]);

  const getOpacity = (pId: string) => {
    if (selectedPerson) return closeFamily.has(pId) ? 1 : FOCUS_DIMMED_OPACITY;
    return 1;
  };

  // --- CALCUL RECURSIF DU LAYOUT ---
  const layout = useMemo(() => {
    const personChildren = new Map<string, Person[]>();
    persons.forEach(p => {
      [p.mere, p.pere].forEach(parentId => {
        if (parentId && personMap.has(parentId)) {
          if (!personChildren.has(parentId)) personChildren.set(parentId, []);
          if (!personChildren.get(parentId)!.some(child => child.id === p.id)) {
            personChildren.get(parentId)!.push(p);
          }
        }
      });
    });

    const units = new Map<string, any>();
    const personToUnit = new Map<string, any>();

    // 1. Création des Unités Familiales
    persons.forEach(p => {
      if (personToUnit.has(p.id)) return;
      if (p.conjoint && personMap.has(p.conjoint)) {
        const spouse = personMap.get(p.conjoint)!;
        if (personToUnit.has(spouse.id)) {
          const u = { id: `single::${p.id}`, members: [p], children: [], isRoot: true, width: 0, x: 0, level: 0, childrenTotalWidth: 0 };
          units.set(u.id, u);
          personToUnit.set(p.id, u);
        } else {
          const unitKey = [p.id, spouse.id].sort().join('::');
          const u = { id: unitKey, members: [p, spouse], children: [], isRoot: true, width: 0, x: 0, level: 0, childrenTotalWidth: 0 };
          units.set(unitKey, u);
          personToUnit.set(p.id, u);
          personToUnit.set(spouse.id, u);
        }
      } else {
        const unitKey = `single::${p.id}`;
        const u = { id: unitKey, members: [p], children: [], isRoot: true, width: 0, x: 0, level: 0, childrenTotalWidth: 0 };
        units.set(unitKey, u);
        personToUnit.set(p.id, u);
      }
    });

    // 2. Hiérarchisation
    units.forEach(u => {
      const childUnits = new Set<any>();
      u.members.forEach((m: Person) => {
        (personChildren.get(m.id) || []).forEach((c: Person) => {
          const cu = personToUnit.get(c.id);
          if (cu && cu !== u) {
            childUnits.add(cu);
            cu.isRoot = false;
          }
        });
      });
      u.children = Array.from(childUnits);
    });

    // 3. Niveaux Y (Parcours BFS)
    const queue = Array.from(units.values()).filter(u => u.isRoot).map(u => ({ u, lvl: 0 }));
    const visited = new Set();
    while (queue.length > 0) {
      const { u, lvl } = queue.shift()!;
      if (visited.has(u)) continue;
      visited.add(u);
      u.level = lvl;
      u.children.forEach((c: any) => queue.push({ u: c, lvl: lvl + 1 }));
    }
    units.forEach(u => {
      if (!visited.has(u)) { u.level = 0; visited.add(u); }
    });

    // 4. Calcul récursif de la largeur
    const calculateWidth = (u: any) => {
      if (u.widthCalculated) return u.width;
      u.widthCalculated = true;
      u.ownWidth = u.members.length === 2 
        ? SPOUSE_GAP + CARD_WIDTH + (PHOTO_DIAMETER / 2) 
        : CARD_WIDTH;
      
      let childrenTotalWidth = 0;
      u.children.forEach((c: any, idx: number) => {
        childrenTotalWidth += calculateWidth(c);
        if (idx < u.children.length - 1) childrenTotalWidth += UNIT_GAP;
      });
      
      u.childrenTotalWidth = childrenTotalWidth;
      u.width = Math.max(u.ownWidth, childrenTotalWidth);
      return u.width;
    };

    const roots = Array.from(units.values()).filter(u => u.isRoot);
    roots.forEach(r => calculateWidth(r));
    units.forEach(u => calculateWidth(u));

    // 5. Coordonnées X
    let currentX = 0;
    const assignX = (u: any, leftBound: number) => {
      if (u.xAssigned) return;
      u.xAssigned = true;
      u.x = leftBound + u.width / 2;
      
      let childLeft = u.x - u.childrenTotalWidth / 2;
      u.children.forEach((c: any) => {
        assignX(c, childLeft);
        childLeft += c.width + UNIT_GAP;
      });
    };

    roots.forEach(r => {
      assignX(r, currentX);
      currentX += r.width + UNIT_GAP * 2;
    });
    units.forEach(u => {
      if (!u.xAssigned) {
        assignX(u, currentX);
        currentX += u.width + UNIT_GAP * 2;
      }
    });

    // 6. Cartes finales avec décalage pour le conjoint de droite
    const memberX = new Map<string, number>();
    const levelMap = new Map<string, number>();
    const childrenByUnion = new Map<string, string[]>();

    units.forEach(u => {
      if (u.members.length === 2) {
        const [m1, m2] = u.members;
        memberX.set(m1.id, u.x - SPOUSE_GAP / 2 - CARD_WIDTH / 2);
        memberX.set(m2.id, u.x + SPOUSE_GAP / 2 - CARD_WIDTH / 2 + (PHOTO_DIAMETER / 2));
        levelMap.set(m1.id, u.level);
        levelMap.set(m2.id, u.level);
      } else {
        const m = u.members[0];
        memberX.set(m.id, u.x - CARD_WIDTH / 2);
        levelMap.set(m.id, u.level);
      }
    });

    persons.forEach(p => {
      const parents = [p.mere, p.pere].filter(id => id && personMap.has(id)).sort();
      if (parents.length > 0) {
        const unionKey = parents.join('::');
        if (!childrenByUnion.has(unionKey)) childrenByUnion.set(unionKey, []);
        childrenByUnion.get(unionKey)!.push(p.id);
      }
    });

    return { memberX, levelMap, childrenByUnion };
  }, [persons, personMap]);

  // --- AUTO-ZOOM SUR LA FAMILLE SÉLECTIONNÉE ---
  useEffect(() => {
    if (!selectedPerson || !containerRef.current || closeFamily.size === 0) return;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    closeFamily.forEach(id => {
      const x = layout.memberX.get(id);
      const y = (layout.levelMap.get(id) ?? 0) * LEVEL_HEIGHT;
      if (x !== undefined) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + CARD_WIDTH);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + CARD_HEIGHT);
      }
    });

    if (minX === Infinity) return;

    const padding = 80;
    const w = maxX - minX;
    const h = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setTimeout(() => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      const scaleX = (width - padding * 2) / (w || 1);
      const scaleY = (height - padding * 2) / (h || 1);
      const targetScale = Math.min(scaleX, scaleY, 1.2); 

      setTransform({
        x: width / 2 - targetScale * cx,
        y: height / 2 - targetScale * cy,
        scale: targetScale
      });
    }, 300);
  }, [selectedPerson, closeFamily, layout]);

  // --- GESTION DES ÉVÉNEMENTS ---
  const handleWheel = (e: ReactWheelEvent) => {
    const scaleAdj = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({ ...prev, scale: Math.max(0.1, Math.min(prev.scale * scaleAdj, 3)) }));
  };

  const handlePointerDown = (e: ReactMouseEvent) => {
    setIsDragging(true);
    dragState.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false };
  };

  const handlePointerMove = (e: ReactMouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragState.current.x;
    const dy = e.clientY - dragState.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.current.moved = true;
    setTransform(prev => ({ ...prev, x: dragState.current.tx + dx, y: dragState.current.ty + dy }));
  };

  const handleSvgClick = () => {
    if (!dragState.current.moved) {
      setSelectedPerson(null);
    }
  };

  const handleNodeClick = (p: Person, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (!dragState.current.moved) {
      setSelectedPerson(p);
    }
  };

  const renderLinks = () => {
    const paths: React.ReactNode[] = [];
    
    layout.childrenByUnion.forEach((childrenIds, unionKey) => {
      const parents = unionKey.split('::');
      let unionX = 0;
      let unionY = 0;

      const p1X = layout.memberX.get(parents[0]);
      const p1Lvl = layout.levelMap.get(parents[0]) || 0;
      if (p1X === undefined) return;

      if (parents.length === 2) {
        const p2X = layout.memberX.get(parents[1]);
        if (p2X !== undefined) {
          const leftX = Math.min(p1X, p2X);
          const rightX = Math.max(p1X, p2X);

          const minX = leftX + CARD_WIDTH;
          const maxX = rightX - PHOTO_DIAMETER / 2;
          
          unionY = p1Lvl * LEVEL_HEIGHT + CARD_HEIGHT / 2;
          unionX = (minX + maxX) / 2;
          
          paths.push(<line key={`couple-${unionKey}`} x1={minX} y1={unionY} x2={maxX} y2={unionY} className="tree-union-line" />);
          paths.push(<circle key={`dot-${unionKey}`} cx={unionX} cy={unionY} r={5} fill="#7a2035" />);
        }
      } else {
        unionX = p1X + CARD_WIDTH / 2;
        unionY = p1Lvl * LEVEL_HEIGHT + CARD_HEIGHT;
      }

      const busY = unionY + (LEVEL_HEIGHT - CARD_HEIGHT) * 0.6;
      const childCoords = childrenIds.map(id => (layout.memberX.get(id) ?? 0) + CARD_WIDTH / 2);
      const minChildX = Math.min(...childCoords);
      const maxChildX = Math.max(...childCoords);

      let d = `M ${unionX} ${unionY} V ${busY} `;
      if (childrenIds.length > 1) {
        d += `M ${minChildX} ${busY} H ${maxChildX} `;
      }
      childrenIds.forEach(id => {
        const cx = (layout.memberX.get(id) ?? 0) + CARD_WIDTH / 2;
        const cy = (layout.levelMap.get(id) ?? 0) * LEVEL_HEIGHT;
        d += `M ${cx} ${busY} V ${cy - 5} `;
      });

      paths.push(<path key={`rake-${unionKey}`} d={d} className="tree-link" />);
    });
    return paths;
  };

  return (
    <div className="genealogy-app">
      <div className="sub-controls">
        <span className="badge">{persons.length} personnes</span>
      </div>

      <div className="genealogy-content">
        <div 
          className="network-container" 
          ref={containerRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setIsDragging(false)}
          onPointerLeave={() => setIsDragging(false)}
          onClick={handleSvgClick}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <svg width="100%" height="100%">
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {renderLinks()}

              {persons.map(p => {
                const x = layout.memberX.get(p.id) ?? 0;
                const y = (layout.levelMap.get(p.id) ?? 0) * LEVEL_HEIGHT;
                const isFemale = p.sexe?.toUpperCase() === 'F';
                const isSelected = selectedPerson?.id === p.id;
                const opacity = getOpacity(p.id);
                const { displayDate, ageText } = getFormattedDateAndAge(p);
                let sub = displayDate || '';
                if (ageText) sub += sub ? ` (${ageText})` : ageText;

                return (
                  <g 
                    key={p.id} 
                    transform={`translate(${x}, ${y})`} 
                    opacity={opacity} 
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => handleNodeClick(p, e)}
                  >
                    <rect
                      width={CARD_WIDTH}
                      height={CARD_HEIGHT}
                      rx={10}
                      fill={isFemale ? '#fcf0f2' : '#f0f4f8'}
                      stroke={isSelected ? '#7a2035' : (isFemale ? '#d98293' : '#7b9cb8')}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />

                    <clipPath id={`clip-${p.id}`}>
                      <circle cx={0} cy={CARD_HEIGHT / 2} r={PHOTO_DIAMETER / 2} />
                    </clipPath>
                    <rect x={-PHOTO_DIAMETER/2} y={CARD_HEIGHT/2 - PHOTO_DIAMETER/2} width={PHOTO_DIAMETER} height={PHOTO_DIAMETER} fill="#e5dacb" clipPath={`url(#clip-${p.id})`} />
                    <image href={getPhotoUrl(p.id)} x={-PHOTO_DIAMETER/2} y={CARD_HEIGHT/2 - PHOTO_DIAMETER/2} width={PHOTO_DIAMETER} height={PHOTO_DIAMETER} clipPath={`url(#clip-${p.id})`} preserveAspectRatio="xMidYMid slice" />
                    <circle cx={0} cy={CARD_HEIGHT / 2} r={PHOTO_DIAMETER / 2} fill="none" stroke="#ffffff" strokeWidth={2} />

                    <foreignObject x={PHOTO_DIAMETER / 2 + 10} y={0} width={CARD_WIDTH - (PHOTO_DIAMETER / 2 + 20)} height={CARD_HEIGHT}>
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#2c1e18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {getDisplayName(p)}
                        </div>
                        {sub && (
                          <div style={{ fontSize: '11px', color: '#8c7a6b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sub}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <div className={`detail-panel ${selectedPerson ? 'open' : ''}`}>
          {selectedPerson && (
            <div className="detail-panel-inner">
              <button className="close-btn" onClick={() => setSelectedPerson(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="detail-photo-wrap">
                <img className="detail-photo" src={getPhotoUrl(selectedPerson.id)} alt={getDisplayName(selectedPerson)} onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} />
              </div>
              <div className="detail-main">
                <h3>{getDisplayName(selectedPerson)}</h3>
                <p className="subtext">{selectedPerson.id}</p>
                <div className="detail-info">
                  {selectedPerson.maison && (<div className="detail-row"><span className="label">Maison</span><span className="value">{selectedPerson.maison}</span></div>)}
                  <div className="detail-row"><span className="label">Sexe</span><span className="value">{selectedPerson.sexe === 'F' ? 'Femme' : 'Homme'}</span></div>
                  {selectedPerson.dateNaissance && (
                    <div className="detail-row">
                      <span className="label">Naissance</span>
                      <span className="value">{selectedPerson.jourMoisNaissance ? `${selectedPerson.jourMoisNaissance}/` : ''}{selectedPerson.dateNaissance}</span>
                    </div>
                  )}
                  {selectedPerson.dateDeces && (<div className="detail-row"><span className="label">Décès</span><span className="value">{selectedPerson.dateDeces}</span></div>)}
                  <div className="detail-row"><span className="label">Statut / Âge</span><span className="value">{getFormattedDateAndAge(selectedPerson).ageText || 'Inconnu'}</span></div>
                  
                  {selectedPerson.conjoint && (() => {
                    const spouse = findOrEmpty(selectedPerson.conjoint);
                    const isSpouseFemale = spouse.sexe?.toUpperCase() === 'F';
                    return (
                      <div className="detail-row">
                        <span className="label">{isSpouseFemale ? 'Conjointe' : 'Conjoint'}</span>
                        <span className="value clickable-link" onClick={() => setSelectedPerson(spouse)}>
                          {getDisplayName(spouse)}
                        </span>
                      </div>
                    );
                  })()}

                  {selectedPerson.mere && (
                    <div className="detail-row"><span className="label">Mère</span><span className="value clickable-link" onClick={() => setSelectedPerson(findOrEmpty(selectedPerson.mere))}>{getDisplayName(findOrEmpty(selectedPerson.mere))}</span></div>
                  )}
                  {selectedPerson.pere && (
                    <div className="detail-row"><span className="label">Père</span><span className="value clickable-link" onClick={() => setSelectedPerson(findOrEmpty(selectedPerson.pere))}>{getDisplayName(findOrEmpty(selectedPerson.pere))}</span></div>
                  )}

                  {selectedPersonChildren.length > 0 && (
                    <div className="detail-row">
                      <span className="label">Enfants ({selectedPersonChildren.length})</span>
                      <span className="value">
                        {selectedPersonChildren.map((child, index) => (
                          <React.Fragment key={child.id}>
                            <span
                              className="clickable-link"
                              onClick={() => setSelectedPerson(child)}
                            >
                              {getDisplayName(child)}
                            </span>
                            {index < selectedPersonChildren.length - 1 && ', '}
                          </React.Fragment>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}