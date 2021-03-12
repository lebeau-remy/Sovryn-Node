const socket = io();

class AppCtrl {
    constructor($scope) {
        this.liquidationWallets = [];
        this.artbitrageWallet = {};
        this.rolloverWallet = {};
        this.$scope = $scope;

        this.start();
    }

    static get $inject() {
        return ['$scope'];
    }

    start() {
        console.log("HELLO FROM ANGULAR")
        this.getAddresses()
    }

    getAddresses() {
        let p=this;

        socket.emit("getAddresses", (res) => {
            console.log("response addresses:", res);

            p.liquidationWallets = res.liquidator;
            p.artbitrageWallet = res.arbitrage;
            p.rolloverWallet = res.rollover;
            console.log('\n Liquidations Wallets', this.liquidationWallets)
            p.$scope.$applyAsync();
        });
    }
}

angular.module('app', []).controller('appCtrl', AppCtrl);

angular.bootstrap(document, ['app']);
