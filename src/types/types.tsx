//types.tsx

export interface Person {
  id: string;
  nomNaissance: string;
  prenom: string;
  autresPrenoms: string;
  dateNaissance: string;
  jourMoisNaissance: string;
  dateDeces: string;
  jourMoisDeces: string;
  mere: string;
  pere: string;
  conjoint: string;
  sexe: string;
  maison: string;
  divorced: boolean;
  quizz: boolean;
}