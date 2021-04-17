/**
 * Rollover the open position (loan or trade) to the next interval, currently 28 days for margin-trades and 1 month for loans
 * Rollover = extend deadline and pay interest
 */

import C from './contract';
import U from '../util/helper';
import Wallet from './wallet';
import conf from '../config/config';
import common from './common'
import abiDecoder from 'abi-decoder';
import abiComplete from "../config/abiComplete";
import tokensDictionary from '../config/tokensDictionary.json'
import Extra from 'telegraf/extra';
import dbCtrl from './db';

class Rollover {
    constructor(){
        this.RolloverErrorList=[];
        abiDecoder.addABI(abiComplete);
    }
    start(positions) {
        this.positions = positions;
        this.checkPositionsExpiration();
    }

    /**
     * Wrapper for rolling over open positions
     * Only rollover if amount > threshold
     * todo: convert btc amount considering real btc price and take from config file
     */
    async checkPositionsExpiration() {
        while (true) {
            console.log("started checking expired positions");

            for (let p in this.positions) {
                const amn = C.web3.utils.fromWei(this.positions[p].collateral.toString(), "Ether");

                if(this.positions[p].collateralToken.toLowerCase() === conf.docToken.toLowerCase() && amn < 5) continue;
                else if(this.positions[p].collateralToken.toLowerCase() === conf.USDTToken.toLowerCase() && amn < 5) continue;
                else if(this.positions[p].collateralToken.toLowerCase() === conf.BProToken.toLowerCase()) continue; //Bpro can't be rolled over. Amm messed up
                else if(this.positions[p].collateralToken.toLowerCase() === conf.testTokenRBTC.toLowerCase() && amn < 0.00025) continue; 
                else if(this.RolloverErrorList[this.positions[p].loanId]>=5) continue;
               
                if (this.positions[p].endTimestamp < Date.now() / 1000) {
                    console.log("Rollover " + this.positions[p].loanId+" pos size: "+amn+" collateralToken: "+conf.tokensDictionary[this.positions[p].collateralToken.toLowerCase()]);
                    const [wallet, wBalance] = await Wallet.getWallet("rollover", 0.001, "rBtc");
                    if (wallet) {
                        const nonce = await C.web3.eth.getTransactionCount(wallet.adr, 'pending');
                        const tx = await this.rollover(this.positions[p], wallet.adr, nonce);
                        if (tx) await this.addTx(tx);
                    } else {
                        await this.handleNoWalletError();
                    }
                }
            }
            console.log("Completed rollover");
            await U.wasteTime(conf.rolloverScanInterval);
        }
    }

    /**
     * Tries to rollover a position
     */
    rollover(pos, wallet, nonce) {
        const p=this;
        return new Promise(async (resolve) => {
            const loanDataBytes = "0x"; //need to be empty

            const gasPrice = await C.getGasPrice();

            C.contractSovryn.methods.rollover(pos.loanId, loanDataBytes)
                .send({ from: wallet, gas: 2500000, gasPrice: gasPrice, nonce:nonce })
                .then(async (tx) => {
                    const msg = `Rollover Transaction successful: ${tx.transactionHash} \n Rolled over position ${pos.loanId} with ${tokensDictionary[conf.network][pos.collateralToken].toLowerCase()} as collateral token`;
                    console.log(msg);
                    common.telegramBot.sendMessage(`<b><u>R</u></b>\t\t\t\t ${conf.network}-${msg}`, Extra.HTML());

                    p.handleRolloverSuccess(pos.loanId);
                    resolve(tx.transactionHash);
                })
                .catch(async (err) => {
                    console.error("Error in rolling over position "+pos.loanId);
                    console.error(err);
                    common.telegramBot.sendMessage(`<b><u>R</u></b>\t\t\t\t ⚠️<b>ERROR</b>⚠️\n Error on rollover tx (loanId ${pos.loanId})`, Extra.HTML());
                    p.handleRolloverError(pos.loanId);
                    resolve();
                });
        });
    }

    handleRolloverSuccess(loanId){
        this.RolloverErrorList[loanId] = null;
    }

    handleRolloverError(loanId){
        if(!this.RolloverErrorList[loanId]) this.RolloverErrorList[loanId]=1;
        else this.RolloverErrorList[loanId]++;
    }


    /**
     * Rollover currently does not emit logs
     */
    async addTx(txHash) {
        try {
            console.log("Add rollover to db");
            const receipt = await C.web3.eth.getTransactionReceipt(txHash);

            if (receipt && receipt.logs) {
                const logs = abiDecoder.decodeLogs(receipt.logs) || [];

                for(let log in logs){
                    if(!logs[log] || logs[log].name != "Conversion") continue;

                    const params = U.parseEventParams(logs[log].events);
                
                    if (params && params.loanId) {
                        await dbCtrl.addRollover({
                            loanId: params.loanId,  
                            txHash: receipt.transactionHash,
                            adr: params.borrower
                        })
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    async handleNoWalletError() {
        console.error("No wallet available for rollover");
        common.telegramBot.sendMessage("<b><u>R</u></b>\t\t\t\t No wallet available for rollover", Extra.HTML());
    }
}

export default new Rollover();
