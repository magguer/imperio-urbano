// Sistema de subastas
import { BOARD } from './board.js';

export function createAuction(cellId, bidders) {
  return {
    cellId,
    bid: 0,
    leader: null,
    bidderQueue: [...bidders],
    currentIdx: 0,
    passed: new Set(),
    done: false,
  };
}

export function getCurrentBidder(auction, players) {
  if (!auction.bidderQueue.length) return null;
  const id = auction.bidderQueue[auction.currentIdx % auction.bidderQueue.length];
  return players[id];
}

export function advanceBidder(auction) {
  auction.currentIdx = (auction.currentIdx + 1) % auction.bidderQueue.length;
}

export function allPassed(auction) {
  return auction.passed.size >= auction.bidderQueue.length;
}

export function placeBid(auction, playerId, amount) {
  if (amount <= auction.bid) return 'La puja debe superar la actual.';
  auction.bid = amount;
  auction.leader = playerId;
  auction.passed.delete(playerId);
  return null;
}

export function passBid(auction, playerId) {
  auction.passed.add(playerId);
}

export function isAuctionOver(auction) {
  if (auction.bidderQueue.length <= 1) return true;
  if (auction.leader !== null && auction.passed.size >= auction.bidderQueue.length - 1) return true;
  if (auction.leader === null && allPassed(auction)) return true;
  return false;
}

export function getAuctionSummary(auction, players, formatMoney) {
  const cell = BOARD[auction.cellId];
  if (auction.leader !== null) {
    const winner = players[auction.leader];
    return { sold: true, winner, cell, amount: auction.bid };
  }
  return { sold: false, cell };
}
