import type { Person } from '../types/types';

export const FALLBACK_SILHOUETTE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="%23c0b0a0"><path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 14c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z"/></svg>';

export function parseCSV(csvText: string): Person[] {
  if (!csvText) return [];
  console.log('Parsing CSV content, length:', csvText.length);

  // Normalise les sauts de ligne (\r\n ou \r -> \n) pour éviter les retours chariots parasites
  const cleanText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = cleanText.split('\n');
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map((h) => h.trim());

  return lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      return {
        id: row['ID'] || '',
        nom: row['Nom'] || '',
        nomNaissance: row['Nom naissance'] || '',
        prenom: row['Prénom'] || '',
        autresPrenoms: row['Autres prénoms'] || '',
        dateNaissance: row['Date naissance'] || '',
        jourMoisNaissance: row['Jour/mois naissance'] || '',
        dateDeces: row['Date décès'] || '',
        mere: row['Mère'] || '',
        pere: row['Père'] || '',
        enfants: row['Enfants'] || '',
        conjoint: row['Conjoint'] || '',
        sexe: row['Sexe'] || '',
        maison: row['Maison'] || '',
      };
    });
}

export function getFormattedName(p: Person): string {
  const nom = p.nomNaissance;
  return `${p.prenom} ${nom}`.trim();
}

export function getFormattedDateAndAge(p: Person): { displayDate: string; ageText: string } {
  const birthYear = parseInt(p.dateNaissance, 10);
  const deathYear = parseInt(p.dateDeces, 10);
  const currentYear = new Date().getFullYear();

  let displayDate = p.dateNaissance;
  if (p.dateDeces) displayDate += ` - ${p.dateDeces}`;

  let ageText = '';
  if (!isNaN(birthYear)) {
    if (!isNaN(deathYear)) {
      ageText = `décédé à ${deathYear - birthYear} ans`;
      if (deathYear - birthYear < 1) {
        ageText = `décédé à moins d'un an`;
      }
    } else {
      ageText = `${currentYear - birthYear} ans`;
    }
  }

  return { displayDate, ageText };
}

// Importation automatique de toutes les images du dossier
const photos = import.meta.glob<string>('../assets/photos/*.{png,jpg,jpeg,PNG,JPG,JPEG}', {
  eager: true,
  import: 'default',
});

export function getPhotoUrl(id: string): string {
  // Recherche du fichier qui correspond à l'ID (ex: "id_123.jpg")
  const matchedPath = Object.keys(photos).find((path) => {
    const filename = path.split('/').pop()?.split('.')[0];
    return filename === id;
  });

  return matchedPath ? photos[matchedPath] : FALLBACK_SILHOUETTE;
}

export function getCloseFamilyIds(target: Person, persons: Person[]): Set<string> {
  const family = new Set<string>();
  family.add(target.id);

  if (target.conjoint) family.add(target.conjoint);
  if (target.mere) family.add(target.mere);
  if (target.pere) family.add(target.pere);

  // Enfants directs
  persons.forEach((p) => {
    if (p.mere === target.id || p.pere === target.id) {
      family.add(p.id);
    }
  });

  // Frères et sœurs directs
  if (target.mere || target.pere) {
    persons.forEach((p) => {
      if (
        (target.mere && p.mere === target.mere) ||
        (target.pere && p.pere === target.pere)
      ) {
        family.add(p.id);
      }
    });
  }

  return family;
}