import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Person } from '../types/types';
import { getFormattedName, getPhotoUrl, FALLBACK_SILHOUETTE } from '../utils/helper';
import { db } from '../firebase';
import { ref, onValue, set, update, remove, get, runTransaction } from 'firebase/database';
import '../styles/GamesPage.css';

interface Props {
  persons: Person[];
}

type QuestionType = 
  | 'MATCH_PHOTO' 
  | 'MATCH_NAME' 
  | 'FIND_PARENT' 
  | 'COUNT_CHILDREN' 
  | 'ORDER_BY_AGE' 
  | 'FIND_HOUSE';

interface Option {
  label: string;
  photoUrl?: string;
  isCorrect: boolean;
  explanation: string;
}

interface Question {
  type: QuestionType;
  prompt: string;
  photoUrl?: string;
  couplePhotos?: [string, string];
  options: Option[];
  correctAnswerLabel: string;
  itemsToOrder?: Person[];
  correctOrderIds?: string[];
  childrenList?: Person[];
  correctCount?: number;
}

interface Player {
  id: string;
  name: string;
  score: number;
  hasAnswered: boolean;
  hasLeft?: boolean;
  earnedPoints?: number;
}

interface RoomState {
  id: string;
  hostId: string;
  status: 'LOBBY' | 'PLAYING' | 'LEADERBOARD' | 'FINISHED';
  currentQuestionIndex: number;
  questionEndsAt: number;
  createdAt?: number;
  questions: Question[];
  players: Record<string, Player>;
  leftCount?: number;
  answerOrder?: string[];
  correctAnswerOrder?: string[];
}

export default function GamesPage({ persons }: Props) {
  const [roomId, setRoomId] = useState<string>('');
  const [inputRoomId, setInputRoomId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [myPlayerId] = useState<string>(() => 'player_' + Math.random().toString(36).substring(2, 9));
  
  const [room, setRoom] = useState<RoomState | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [localIsCorrect, setLocalIsCorrect] = useState<boolean | null>(null);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [userOrder, setUserOrder] = useState<Person[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // Refs pour éviter les closures obsolètes dans les timers
  const roomRefState = useRef(room);
  roomRefState.current = room;
  const userOrderRef = useRef(userOrder);
  userOrderRef.current = userOrder;
  const sliderValueRef = useRef(sliderValue);
  sliderValueRef.current = sliderValue;

  const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

  const getSortableDate = (p: Person): number => {
    let day = 1, month = 0;
    if (p.jourMoisNaissance) {
      const parts = p.jourMoisNaissance.split(/[-/]/);
      if (parts.length >= 2) {
        day = parseInt(parts[0], 10) || 1;
        month = (parseInt(parts[1], 10) || 1) - 1;
      }
    }
    const year = parseInt(p.dateNaissance, 10) || 0;
    return new Date(year, month, day).getTime();
  };

  const generateQuestions = useCallback(() => {
    if (persons.length < 5) return [];
    
    const allTypes: QuestionType[] = [
      'MATCH_PHOTO', 'MATCH_NAME', 'FIND_PARENT', 
      'COUNT_CHILDREN', 'ORDER_BY_AGE', 'FIND_HOUSE'
    ];

    const generated: Question[] = [];
    const usedTargetsByQuiz = new Set<string>();

    const mandatoryTypes = shuffle([...allTypes]);

    for (const qType of mandatoryTypes) {
      const q = buildQuestionForType(qType, persons, usedTargetsByQuiz);
      if (q) {
        generated.push(q);
      }
    }

    while (generated.length < 10) {
      const randomType = shuffle(allTypes)[0];
      const q = buildQuestionForType(randomType, persons, usedTargetsByQuiz);
      if (q) {
        generated.push(q);
      } else {
        const fallbackQ = buildQuestionForType('MATCH_PHOTO', persons, usedTargetsByQuiz);
        if (fallbackQ) generated.push(fallbackQ);
        else break;
      }
    }

    return shuffle(generated);
  }, [persons]);

  const buildQuestionForType = (qType: QuestionType, personsList: Person[], usedTargets: Set<string>): Question | null => {
    if (qType === 'FIND_HOUSE') {
      const candidates = personsList.filter((p) => p.maison && p.maison.trim() !== '' && !usedTargets.has(`house_${p.id}`));
      if (candidates.length < 3) return null;
      const target = shuffle(candidates)[0];
      usedTargets.add(`house_${target.id}`);

      const correctHouse = target.maison;
      const allHouses = Array.from(new Set(personsList.map(p => p.maison).filter(Boolean)));
      const otherHouses = allHouses.filter(h => h !== correctHouse);
      if (otherHouses.length < 2) return null;

      const distractors = shuffle(otherHouses).slice(0, 2);
      return {
        type: qType,
        prompt: `À quelle maison (ou famille) appartient ${target.prenom || getFormattedName(target)} ?`,
        photoUrl: getPhotoUrl(target.id),
        options: shuffle([
          { label: correctHouse, isCorrect: true, explanation: `${getFormattedName(target)} appartient bien à la maison ${correctHouse}.` },
          ...distractors.map((d) => ({ label: d, isCorrect: false, explanation: `Non, ${getFormattedName(target)} n'appartient pas à la maison ${d}.` }))
        ]),
        correctAnswerLabel: correctHouse,
      };
    }

    if (qType === 'ORDER_BY_AGE') {
      const candidates = personsList.filter((p) => p.dateNaissance && p.jourMoisNaissance && (!p.dateDeces || p.dateDeces.trim() === ''));
      if (candidates.length < 5) return null;
      const items = shuffle(candidates).slice(0, 5);
      const sorted = [...items].sort((a, b) => getSortableDate(a) - getSortableDate(b));
      
      return {
        type: qType,
        prompt: `Rangez ces personnes de la plus ÂGÉE à la plus JEUNE (Haut = plus âgé)`,
        options: [
          { label: 'Faux', isCorrect: false, explanation: 'L\'ordre n\'était pas parfait.' },
          { label: 'Vrai', isCorrect: true, explanation: 'Bravo, c\'est l\'ordre exact !' }
        ],
        correctAnswerLabel: sorted.map(p => p.prenom || getFormattedName(p)).join(' ➔ '),
        itemsToOrder: items, 
        correctOrderIds: sorted.map(p => p.id), 
      };
    }

    if (qType === 'MATCH_PHOTO') {
      const candidates = personsList.filter(p => !usedTargets.has(`mp_${p.id}`));
      if (candidates.length < 3) return null;
      const target = shuffle(candidates)[0];
      usedTargets.add(`mp_${target.id}`);

      const sameGender = personsList.filter((p) => p.id !== target.id && (!target.sexe || p.sexe === target.sexe));
      const pool = sameGender.length >= 2 ? sameGender : personsList.filter((p) => p.id !== target.id);
      const distractors = shuffle(pool).slice(0, 2);

      return {
        type: qType,
        prompt: `Retrouvez la photo de : ${getFormattedName(target)}`,
        options: shuffle([
          { label: getFormattedName(target), photoUrl: getPhotoUrl(target.id), isCorrect: true, explanation: `C'est bien ${getFormattedName(target)}.` },
          ...distractors.map((d) => ({ label: getFormattedName(d), photoUrl: getPhotoUrl(d.id), isCorrect: false, explanation: `C'était ${getFormattedName(d)}.` }))
        ]),
        correctAnswerLabel: getFormattedName(target),
      };
    }

    if (qType === 'MATCH_NAME') {
      const candidates = personsList.filter(p => !usedTargets.has(`mn_${p.id}`));
      if (candidates.length < 3) return null;
      const target = shuffle(candidates)[0];
      usedTargets.add(`mn_${target.id}`);

      const sameGender = personsList.filter((p) => p.id !== target.id && (!target.sexe || p.sexe === target.sexe));
      const pool = sameGender.length >= 2 ? sameGender : personsList.filter((p) => p.id !== target.id);
      const distractors = shuffle(pool).slice(0, 2);

      return {
        type: qType,
        prompt: `Qui est représenté sur cette photo ?`,
        photoUrl: getPhotoUrl(target.id),
        options: shuffle([
          { label: getFormattedName(target), isCorrect: true, explanation: `Exact ! C'est ${getFormattedName(target)}.` },
          ...distractors.map((d) => ({ label: getFormattedName(d), isCorrect: false, explanation: `C'était en fait ${getFormattedName(target)}.` }))
        ]),
        correctAnswerLabel: getFormattedName(target),
      };
    }

    if (qType === 'FIND_PARENT') {
      const candidates = personsList.filter((p) => (p.mere || p.pere) && !usedTargets.has(`fp_${p.id}`));
      if (candidates.length === 0) return null;
      const target = shuffle(candidates)[0];
      usedTargets.add(`fp_${target.id}`);

      const parentId = target.mere || target.pere;
      const parent = personsList.find((p) => p.id === parentId);
      if (!parent) return null;

      const distractors = shuffle(personsList.filter((p) => p.id !== parent.id && p.id !== target.id)).slice(0, 2);
      if (distractors.length < 2) return null;

      return {
        type: qType,
        prompt: `Trouve le père ou la mère de ${getFormattedName(target)} ?`,
        options: shuffle([
          { label: getFormattedName(parent), photoUrl: getPhotoUrl(parent.id), isCorrect: true, explanation: `${getFormattedName(parent)} est ${parent.sexe === 'M' ? 'le père' : 'la mère'} de ${getFormattedName(target)}.` },
          ...distractors.map((d) => ({ label: getFormattedName(d), photoUrl: getPhotoUrl(d.id), isCorrect: false, explanation: `${getFormattedName(d)} n'est pas un des parents de ${getFormattedName(target)}.` }))
        ]),
        correctAnswerLabel: getFormattedName(parent),
      };
    }

    if (qType === 'COUNT_CHILDREN') {
      const couples = personsList.filter((p) => p.conjoint && personsList.some((c) => c.id === p.conjoint) && !usedTargets.has(`cc_${p.id}`));
      if (couples.length === 0) return null;
      const target = shuffle(couples)[0];
      usedTargets.add(`cc_${target.id}`);

      const conjoint = personsList.find((p) => p.id === target.conjoint);
      if (!conjoint) return null;

      const childrenList = personsList.filter((p) => p.mere === target.id || p.pere === target.id || p.mere === conjoint.id || p.pere === conjoint.id);

      return {
        type: 'COUNT_CHILDREN',
        prompt: `Combien d'enfants a ce couple ?`,
        couplePhotos: [getPhotoUrl(target.id), getPhotoUrl(conjoint.id)],
        options: [
          { label: 'Faux', isCorrect: false, explanation: `Raté, ils ont ${childrenList.length} enfants !` },
          { label: 'Vrai', isCorrect: true, explanation: `Parfait ! Ce couple a bien ${childrenList.length} enfant(s).` }
        ],
        correctAnswerLabel: `${childrenList.length} enfant(s)`,
        childrenList,
        correctCount: childrenList.length,
      };
    }

    return null;
  };

  useEffect(() => {
    if (!roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setRoom(data);
      else { setRoom(null); setRoomId(''); }
    });
    return () => unsubscribe();
  }, [roomId]);

  const isPlaying = room?.status === 'PLAYING';
  const qIndex = room?.currentQuestionIndex;

  useEffect(() => {
    if (isPlaying && qIndex !== undefined) {
      setSelectedOption(null);
      setLocalIsCorrect(null);
      setSliderValue(0);
      
      const q = room?.questions?.[qIndex];
      if (q?.type === 'ORDER_BY_AGE' && q.itemsToOrder) {
        setUserOrder(q.itemsToOrder);
      }
    }
  }, [isPlaying, qIndex]); 

  const isHost = room?.hostId === myPlayerId;

  // --- LOGIQUE DE SOUMISSION AVEC GESTION DU TEMPS ÉCOULÉ ---
  const submitAnswer = useCallback(async (isCorrect: boolean, optionIdx: number | null = null, earnedBasePoints: number = 0, isTimeout: boolean = false) => {
    const currentRoom = roomRefState.current;
    if (!currentRoom || currentRoom.players[myPlayerId]?.hasAnswered) return;
    
    setSelectedOption(optionIdx);
    setLocalIsCorrect(isCorrect);

    const roomRef = ref(db, `rooms/${roomId}`);
    
    await runTransaction(roomRef, (roomData) => {
      if (!roomData) return roomData;
      if (!roomData.players[myPlayerId] || roomData.players[myPlayerId].hasAnswered) return roomData;

      const totalPlayers = Object.keys(roomData.players).length;
      
      if (!roomData.answerOrder) roomData.answerOrder = [];
      if (!roomData.correctAnswerOrder) roomData.correctAnswerOrder = [];

      let submissionIndex = -1;
      if (!isTimeout) {
        roomData.answerOrder.push(myPlayerId);
        submissionIndex = roomData.answerOrder.length - 1;
      }

      let questionPoints = 0;
      const currentQ = roomData.questions[roomData.currentQuestionIndex];

      if (currentQ.type === 'ORDER_BY_AGE') {
        const basePts = earnedBasePoints;
        const bonusPts = isTimeout ? 0 : Math.max(0, totalPlayers - submissionIndex);
        questionPoints = basePts + bonusPts;
      } else {
        if (isCorrect) {
          if (!isTimeout) {
            roomData.correctAnswerOrder.push(myPlayerId);
            const correctIndex = roomData.correctAnswerOrder.length - 1;
            questionPoints = Math.max(1, totalPlayers - correctIndex);
          } else {
            questionPoints = earnedBasePoints > 0 ? earnedBasePoints : 1;
          }
        } else {
          questionPoints = 0;
        }
      }

      const currentScore = roomData.players[myPlayerId].score || 0;
      roomData.players[myPlayerId].score = currentScore + questionPoints;
      roomData.players[myPlayerId].hasAnswered = true;
      roomData.players[myPlayerId].earnedPoints = questionPoints;

      return roomData;
    });
  }, [roomId, myPlayerId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentRoom = roomRefState.current;
      if (!currentRoom || currentRoom.status !== 'PLAYING') return;

      const remaining = Math.max(0, Math.ceil((currentRoom.questionEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);

      const players = Object.values(currentRoom.players || {});
      const allAnswered = players.length > 0 && players.every(p => p.hasAnswered);
      const myPlayer = currentRoom.players[myPlayerId];

      if (remaining === 0 && myPlayer && !myPlayer.hasAnswered) {
        const currentQ = currentRoom.questions[currentRoom.currentQuestionIndex];
        if (currentQ.type === 'ORDER_BY_AGE') {
          const currentOrder = userOrderRef.current;
          const correctCount = currentOrder.filter((p, idx) => p.id === currentQ.correctOrderIds![idx]).length;
          const isPerfect = correctCount === currentQ.correctOrderIds!.length;
          submitAnswer(isPerfect, null, correctCount, true);
        } else if (currentQ.type === 'COUNT_CHILDREN') {
          const val = sliderValueRef.current;
          const isCorrect = val === currentQ.correctCount;
          submitAnswer(isCorrect, null, isCorrect ? 1 : 0, true);
        } else {
          submitAnswer(false, null, 0, true);
        }
      }

      const isHostPlayer = currentRoom.hostId === myPlayerId;
      if ((remaining === 0 || allAnswered) && isHostPlayer) {
        update(ref(db, `rooms/${currentRoom.id}`), { status: 'LEADERBOARD' });
      }
    }, 200);

    return () => clearInterval(interval);
  }, [roomId, myPlayerId, submitAnswer]);

  const createRoom = async () => {
    if (!playerName.trim()) return alert('Entrez un pseudo');
    
    let candidateId = '';
    let foundFreeRoom = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!foundFreeRoom && attempts < maxAttempts) {
      attempts++;
      const randomNum = Math.floor(Math.random() * 1000);
      candidateId = randomNum.toString().padStart(3, '0');

      const roomRef = ref(db, `rooms/${candidateId}`);
      const snapshot = await get(roomRef);

      if (!snapshot.exists()) {
        foundFreeRoom = true;
      } else {
        const roomData = snapshot.val();
        const createdAt = roomData.createdAt || 0;
        const age = Date.now() - createdAt;
        if (age > 3600000) {
          foundFreeRoom = true;
        }
      }
    }

    if (!foundFreeRoom) {
      alert("Impossible de trouver un numéro de room libre. Réessayez.");
      return;
    }

    await set(ref(db, `rooms/${candidateId}`), {
      id: candidateId, 
      hostId: myPlayerId, 
      status: 'LOBBY', 
      currentQuestionIndex: 0, 
      questionEndsAt: 0,
      createdAt: Date.now(),
      questions: generateQuestions(),
      players: { [myPlayerId]: { id: myPlayerId, name: playerName, score: 0, hasAnswered: false, hasLeft: false, earnedPoints: 0 } },
      leftCount: 0,
      answerOrder: [],
      correctAnswerOrder: []
    });
    setRoomId(candidateId);
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !inputRoomId.trim()) return alert('Remplissez tous les champs');
    const targetRoomId = inputRoomId.trim().padStart(3, '0');
    
    const roomRef = ref(db, `rooms/${targetRoomId}`);
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) {
      alert("Cette room n'existe pas ou a expiré !");
      return;
    }

    await set(ref(db, `rooms/${targetRoomId}/players/${myPlayerId}`), {
      id: myPlayerId, name: playerName, score: 0, hasAnswered: false, hasLeft: false, earnedPoints: 0
    });
    setRoomId(targetRoomId);
  };

  const startGame = async () => {
    if (!room) return;
    const firstQDuration = room.questions[0].type === 'ORDER_BY_AGE' ? 25000 : 20000;
    await update(ref(db, `rooms/${roomId}`), { 
      status: 'PLAYING', 
      currentQuestionIndex: 0, 
      questionEndsAt: Date.now() + firstQDuration,
      answerOrder: [],
      correctAnswerOrder: []
    });
  };

  const nextQuestion = async () => {
    if (!room) return;
    const nextIdx = room.currentQuestionIndex + 1;
    if (nextIdx >= room.questions.length) {
      await update(ref(db, `rooms/${roomId}`), { status: 'FINISHED' });
      return;
    }
    const updatedPlayers = { ...room.players };
    Object.keys(updatedPlayers).forEach(pId => {
      updatedPlayers[pId].hasAnswered = false;
      updatedPlayers[pId].earnedPoints = 0;
    });
    
    const duration = room.questions[nextIdx].type === 'ORDER_BY_AGE' ? 25000 : 20000;
    await update(ref(db, `rooms/${roomId}`), {
      status: 'PLAYING', 
      currentQuestionIndex: nextIdx, 
      questionEndsAt: Date.now() + duration, 
      players: updatedPlayers,
      answerOrder: [],
      correctAnswerOrder: []
    });
  };

  const validateOrder = () => {
    const currentQ = room!.questions[room!.currentQuestionIndex];
    const correctCount = userOrder.filter((p, idx) => p.id === currentQ.correctOrderIds![idx]).length;
    const isPerfect = correctCount === currentQ.correctOrderIds!.length;
    submitAnswer(isPerfect, null, correctCount, false);
  };

  const validateSlider = () => {
    const currentQ = room!.questions[room!.currentQuestionIndex];
    const isCorrect = sliderValue === currentQ.correctCount;
    submitAnswer(isCorrect, null, isCorrect ? 1 : 0, false);
  };

  const moveItem = (idx: number, dir: 'UP' | 'DOWN') => {
    const newOrder = [...userOrder];
    const targetIdx = dir === 'UP' ? idx - 1 : idx + 1;
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    setUserOrder(newOrder);
  };

  const onDragStart = (e: React.DragEvent, idx: number) => { setDraggedIdx(idx); e.dataTransfer.effectAllowed = "move"; };
  const onDragEnd = () => setDraggedIdx(null);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const newOrder = [...userOrder];
    const draggedItem = newOrder[draggedIdx];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(idx, 0, draggedItem);
    setDraggedIdx(idx);
    setUserOrder(newOrder);
  };

  if (!room) {
    return (
      <div className="games-container">
        <div className="game-card welcome-card">
          <h2>🎮 Quizz Multijoueur</h2>
          <div className="multiplayer-form">
            <input type="text" placeholder="Votre pseudo" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="text-input"/>
            <button className="primary-btn" onClick={createRoom}>Créer une Room</button>
            <div className="join-group">
              <input type="text" maxLength={3} placeholder="Code (ex: 042)" value={inputRoomId} onChange={(e) => setInputRoomId(e.target.value)} className="text-input"/>
              <button className="secondary-btn" onClick={joinRoom}>Rejoindre</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (room.status === 'LOBBY') {
    return (
      <div className="games-container">
        <div className="game-card">
          <h2>Room n° <span className="room-code">{room.id}</span></h2>
          <div className="players-list">
            <h4>Joueurs ({Object.keys(room.players || {}).length}) :</h4>
            <ul>{Object.values(room.players || {}).map((p) => <li key={p.id}>👤 {p.name} {p.id === room.hostId && '(Hôte)'}</li>)}</ul>
          </div>
          {isHost ? <button className="primary-btn" onClick={startGame}>Lancer 🚀</button> : <p>En attente de l'hôte...</p>}
        </div>
      </div>
    );
  }

  if (room.status === 'PLAYING' || room.status === 'LEADERBOARD') {
    const currentQ = room.questions[room.currentQuestionIndex];
    const myPlayer = room.players[myPlayerId];
    const playersList = Object.values(room.players || {});
    const answeredCount = playersList.filter(p => p.hasAnswered).length;
    
    const isAnswered = myPlayer?.hasAnswered || room.status === 'LEADERBOARD';
    const isPhotoOnlyQuestion = currentQ.type === 'MATCH_PHOTO' || currentQ.type === 'FIND_PARENT';
    const showResults = room.status === 'LEADERBOARD';

    return (
      <div className="games-container">
        <div className="game-card">
          <div className="game-header">
            <span>Question {room.currentQuestionIndex + 1} / {room.questions.length}</span>
            {room.status === 'PLAYING' && (
              <div className="header-right">
                <span className="answered-badge">{answeredCount}/{playersList.length} ont répondu</span>
                <span className={`timer-badge ${timeLeft <= 5 ? 'warning' : ''}`}>⏱️ {timeLeft}s</span>
              </div>
            )}
          </div>

          <h3 className="prompt">{currentQ.prompt}</h3>

          {currentQ.photoUrl && (
            <div className="question-photo-wrap">
              <img src={currentQ.photoUrl} alt="Question" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} />
            </div>
          )}
          {currentQ.couplePhotos && (
            <div className="couple-photos">
              <div className="photo-frame"><img src={currentQ.couplePhotos[0]} alt="C1" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} /></div>
              <span className="couple-plus">+</span>
              <div className="photo-frame"><img src={currentQ.couplePhotos[1]} alt="C2" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} /></div>
            </div>
          )}

          {currentQ.type === 'COUNT_CHILDREN' ? (
            <div className="slider-question-container">
              <div className="slider-wrap">
                <span 
                  className="slider-val" 
                  style={{ 
                    color: showResults 
                      ? (sliderValue === currentQ.correctCount ? '#4caf50' : '#f44336') 
                      : (isAnswered ? '#8c7365' : 'inherit'),
                    fontWeight: isAnswered ? 'bold' : 'normal'
                  }}
                >
                  {sliderValue} enfant(s)
                </span>
                <input 
                  type="range" 
                  min="0" 
                  max="15" 
                  value={sliderValue} 
                  onChange={(e) => setSliderValue(parseInt(e.target.value, 10))} 
                  disabled={isAnswered} 
                  className="children-slider" 
                />
              </div>
              {!isAnswered && <button className="primary-btn validate-slider-btn" onClick={validateSlider}>Valider</button>}
            </div>
          ) : currentQ.type === 'ORDER_BY_AGE' ? (
            <div className="order-list-container">
              <div className="order-list">
                {userOrder.map((person, index) => {
                  let itemClass = '';
                  if (showResults) {
                    itemClass = currentQ.correctOrderIds?.[index] === person.id ? 'order-correct' : 'order-wrong';
                  } else if (isAnswered) {
                    itemClass = 'selected';
                  }

                  return (
                    <div key={person.id} className={`order-item ${itemClass}`} draggable={!isAnswered} onDragStart={(e) => onDragStart(e, index)} onDragOver={(e) => onDragOver(e, index)} onDragEnd={onDragEnd}>
                      <div className="order-item-content">
                        <span className="order-item-index">{index + 1}.</span>
                        <span className="order-item-name">{getFormattedName(person)}</span>
                      </div>
                      {!isAnswered && (
                        <div className="order-controls">
                          <button className="order-btn" onClick={() => moveItem(index, 'UP')} disabled={index === 0}>↑</button>
                          <button className="order-btn" onClick={() => moveItem(index, 'DOWN')} disabled={index === userOrder.length - 1}>↓</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!isAnswered && <button className="primary-btn validate-order-btn" onClick={validateOrder}>Valider mon ordre</button>}
            </div>
          ) : (
            <div className={`options-grid ${isPhotoOnlyQuestion ? 'photo-grid' : 'text-grid'}`}>
              {currentQ.options.map((opt, idx) => {
                let btnClass = 'option-btn';
                if (isPhotoOnlyQuestion) btnClass += ' photo-only-btn';
                
                if (showResults) {
                  if (opt.isCorrect) btnClass += ' correct';
                  else if (selectedOption === idx) btnClass += ' wrong';
                  else btnClass += ' dimmed';
                } else if (isAnswered) {
                  if (selectedOption === idx) btnClass += ' selected';
                  else btnClass += ' dimmed';
                }

                return (
                  <button key={idx} className={btnClass} onClick={() => submitAnswer(opt.isCorrect, idx, 0, false)} disabled={isAnswered}>
                    {opt.photoUrl && <div className="option-img-wrapper"><img src={opt.photoUrl} alt="Option" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} /></div>}
                    {(!isPhotoOnlyQuestion || showResults) && <span className="option-label">{opt.label}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {room.status === 'PLAYING' && myPlayer?.hasAnswered && (
            <div className="waiting-banner">✅ Réponse enregistrée ! En attente des autres joueurs...</div>
          )}

          {room.status === 'LEADERBOARD' && (
            <>
              <div className={`feedback-banner ${localIsCorrect === null ? 'wrong-banner' : localIsCorrect ? 'correct-banner' : 'wrong-banner'}`}>
                <div className="feedback-header">
                  <span className="feedback-icon">{localIsCorrect ? '🎉' : '❌'}</span>
                  <h4>{localIsCorrect === null ? 'Temps écoulé !' : localIsCorrect ? 'Bonne réponse !' : 'Mauvaise réponse !'}</h4>
                </div>
                
                <p className="feedback-explanation">
                  {selectedOption !== null ? currentQ.options[selectedOption]?.explanation : `La bonne réponse était : ${currentQ.correctAnswerLabel}`}
                </p>

                {currentQ.type === 'COUNT_CHILDREN' && (
                  <div className="children-details-container">
                    {currentQ.childrenList && currentQ.childrenList.length > 0 && (
                      <div className="children-cards-grid">
                        {currentQ.childrenList.map((child) => (
                          <div key={child.id} className="child-detail-card">
                            <img src={getPhotoUrl(child.id)} alt="Enfant" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_SILHOUETTE; }} />
                            <span>{getFormattedName(child)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="multiplayer-leaderboard-section">
                <h2>🏆 Classement Actuel</h2>
                <div className="leaderboard-list">
                  {playersList.sort((a, b) => b.score - a.score).map((p, rank) => {
                    const earned = p.earnedPoints || 0;
                    const prevScore = (p.score || 0) - earned;
                    return (
                      <div key={p.id} className={`leaderboard-item ${p.id === myPlayerId ? 'highlight' : ''}`}>
                        <span>#{rank + 1} {p.name}</span>
                        <span>
                          {prevScore} <span style={{ color: '#4caf50', fontWeight: 'bold' }}>+{earned}</span> pt(s)
                        </span>
                      </div>
                    );
                  })}
                </div>
                {isHost && (
                  <button className="primary-btn mt-3" onClick={nextQuestion}>
                    {room.currentQuestionIndex + 1 === room.questions.length ? 'Voir les résultats finaux' : 'Question suivante ➔'}
                  </button>
                )}
                {!isHost && <p className="waiting-host-text">En attente de l'hôte...</p>}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (room.status === 'FINISHED') {
    const sorted = Object.values(room.players || {}).sort((a, b) => b.score - a.score);
    const totalPlayersCount = Object.keys(room.players || {}).length;

    const handleLeaveRoom = async () => {
      try {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (snapshot.exists()) {
          const roomData = snapshot.val();
          const currentLeftCount = roomData.leftCount || 0;
          const newLeftCount = currentLeftCount + 1;

          if (newLeftCount >= totalPlayersCount) {
            await remove(roomRef);
          } else {
            await update(roomRef, { leftCount: newLeftCount });
          }
        }
      } catch (error) {
        console.error("Erreur lors de la fermeture/du départ :", error);
      } finally {
        setRoom(null);
        setRoomId('');
      }
    };

    return (
      <div className="games-container">
        <div className="game-card result-card">
          <div className="result-icon">👑</div>
          <h2>Victoire de {sorted[0]?.name} !</h2>
          <div className="leaderboard-list">
            {sorted.map((p, rank) => (
              <div key={p.id} className={`leaderboard-item ${p.id === myPlayerId ? 'highlight' : ''}`}>
                <span>#{rank + 1} {p.name}</span>
                <span>{p.score} pts</span>
              </div>
            ))}
          </div>
          <button className="primary-btn" onClick={handleLeaveRoom}>
            Quitter la room
          </button>
        </div>
      </div>
    );
  }

  return null;
}