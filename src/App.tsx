import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import { parseCSV } from './utils/helper';
import GenealogyPage from './pages/GenealogyPage';
import GamesPage from './pages/GamesPage';

type Page = 'genealogie' | 'jeux';

export default function App() {
  const [csvContent, setCsvContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [page, setPage] = useState<Page>('genealogie');

  useEffect(() => {
    // Le fichier dans public/ est accessible directement via son nom
    fetch('/Genealogie_Mignot_Montgolfier.csv')
      .then((res) => {
        if (!res.ok) throw new Error('Erreur lors du chargement');
        return res.text();
      })
      .then((text) => {
        setCsvContent(text);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Erreur chargement CSV:', err);
        setIsLoading(false);
      });
  }, []);

  const persons = useMemo(() => parseCSV(csvContent), [csvContent]);

  if (isLoading) {
    return <div className="loading-state">Chargement de l'arbre...</div>;
  }

  return (
    <div className="app-shell">
      <nav className="top-nav">
        <div className="brand">🌳 Généalogie Famille Louis Léon &amp; Marie-Josephe Mignot</div>
        <div className="nav-tabs">
          <button
            className={`nav-tab ${page === 'genealogie' ? 'active' : ''}`}
            onClick={() => setPage('genealogie')}
          >
            Généalogie
          </button>
          <button
            className={`nav-tab ${page === 'jeux' ? 'active' : ''}`}
            onClick={() => setPage('jeux')}
          >
            Mini-jeux
          </button>
        </div>
      </nav>

      <div className="page-body">
        {page === 'genealogie' ? (
          <GenealogyPage persons={persons} />
        ) : (
          <GamesPage persons={persons} />
        )}
      </div>
    </div>
  );
}