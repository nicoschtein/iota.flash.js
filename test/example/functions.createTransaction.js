const transfer = require("../../lib/transfer");
const multisig = require("../../lib/multisig");
const Helpers = require("../../examples/functions");
const chai = require('chai');
const assert = chai.assert;

const ONE_SEED =
    "USERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSERONEUSER";
const ONE_SETTLEMENT =
    "USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9USERONE9ADDRESS9U";
const TWO_SEED =
    "USERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSERTWOUSER";
const TWO_SETTLEMENT =
    "USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9USERTWO9ADDRESS9U";

const SECURITY = 2;
const SIGNERS_COUNT = 2;
const TREE_DEPTH = 4;
const CHANNEL_BALANCE = 2000;
const DEPOSITS = [1000, 1000];


describe('functions.createTransaction', function () {

    this.timeout(30000);

    let oneFlash;
    let twoFlash;

    beforeEach(function () {
        oneFlash = {
            userIndex: 0,
            userSeed: ONE_SEED,
            index: 0,
            security: SECURITY,
            depth: TREE_DEPTH,
            bundles: [],
            partialDigests: [],
            flash: {
                signersCount: SIGNERS_COUNT,
                balance: CHANNEL_BALANCE,
                deposit: DEPOSITS.slice(), // Clone correctly
                outputs: {},
                transfers: []
            }
        };
        twoFlash = {
            userIndex: 1,
            userSeed: TWO_SEED,
            index: 0,
            security: SECURITY,
            depth: TREE_DEPTH,
            bundles: [],
            partialDigests: [],
            flash: {
                signersCount: SIGNERS_COUNT,
                balance: CHANNEL_BALANCE,
                deposit: DEPOSITS.slice(), // Clone correctly
                outputs: {},
                transfers: []
            }
        };

        for (let i = 0; i < TREE_DEPTH + 1; i++) {
            // Create new digest
            const digest = multisig.getDigest(
                oneFlash.userSeed,
                oneFlash.index,
                oneFlash.security
            );
            // Increment key index
            oneFlash.index++;
            oneFlash.partialDigests.push(digest)
        }

        // Create digests for the start of the channel
        for (let i = 0; i < TREE_DEPTH + 1; i++) {
            // Create new digest
            const digest = multisig.getDigest(
                twoFlash.userSeed,
                twoFlash.index,
                twoFlash.security
            );
            // Increment key index
            twoFlash.index++;
            twoFlash.partialDigests.push(digest)
        }
        // Make an array of digests
        let allDigests = [];
        allDigests[oneFlash.userIndex] = oneFlash.partialDigests;
        allDigests[twoFlash.userIndex] = twoFlash.partialDigests;

        // Generate the first addresses
        let oneMultisigs = oneFlash.partialDigests.map((digest, index) => {
            // Create address
            let addy = multisig.composeAddress(
                allDigests.map(userDigests => userDigests[index])
            );
            // Add key index in
            addy.index = digest.index;
            // Add the signing index to the object IMPORTANT
            addy.signingIndex = oneFlash.userIndex * digest.security;
            // Get the sum of all digest security to get address security sum
            addy.securitySum = allDigests
                .map(userDigests => userDigests[index])
                .reduce((acc, v) => acc + v.security, 0);
            // Add Security
            addy.security = digest.security;
            return addy
        });

        let twoMultisigs = twoFlash.partialDigests.map((digest, index) => {
            // Create address
            let addy = multisig.composeAddress(
                allDigests.map(userDigests => userDigests[index])
            );
            // Add key index in
            addy.index = digest.index;
            // Add the signing index to the object IMPORTANT
            addy.signingIndex = twoFlash.userIndex * digest.security;
            // Get the sum of all digest security to get address security sum
            addy.securitySum = allDigests
                .map(userDigests => userDigests[index])
                .reduce((acc, v) => acc + v.security, 0);
            // Add Security
            addy.security = digest.security;
            return addy
        });

        // Set remainder address (Same on both users)
        oneFlash.flash.remainderAddress = oneMultisigs.shift();
        twoFlash.flash.remainderAddress = twoMultisigs.shift();

        // Nest trees
        for (let i = 1; i < oneMultisigs.length; i++) {
            oneMultisigs[i - 1].children.push(oneMultisigs[i])
        }
        for (let i = 1; i < twoMultisigs.length; i++) {
            twoMultisigs[i - 1].children.push(twoMultisigs[i])
        }

        // Set Flash root
        oneFlash.flash.root = oneMultisigs.shift();
        twoFlash.flash.root = twoMultisigs.shift();

        // Set settlement addresses (Usually sent over when the digests are.)
        let settlementAddresses = [ONE_SETTLEMENT, TWO_SETTLEMENT];
        oneFlash.flash.settlementAddresses = settlementAddresses;
        twoFlash.flash.settlementAddresses = settlementAddresses;

        // Set digest/key index
        oneFlash.index = oneFlash.partialDigests.length;
        twoFlash.index = twoFlash.partialDigests.length;
    });

    it('Creating a closing transaction should produce the proper bundle', function () {

        // Create, sign and apply transaction
        let transfers = [{value: 200, address: TWO_SETTLEMENT}];
        let bundles = Helpers.createTransaction(oneFlash, transfers, false);
        let oneSignatures = Helpers.signTransaction(oneFlash, bundles);
        let twoSignatures = Helpers.signTransaction(twoFlash, bundles);
        let signedBundles = transfer.appliedSignatures(bundles, oneSignatures);
        signedBundles = transfer.appliedSignatures(signedBundles, twoSignatures);
        oneFlash = Helpers.applyTransfers(oneFlash, signedBundles);
        oneFlash.bundles = signedBundles;
        twoFlash = Helpers.applyTransfers(twoFlash, signedBundles);
        twoFlash.bundles = signedBundles;

        // Closing channel
        bundles = Helpers.createTransaction(
            oneFlash,
            oneFlash.flash.settlementAddresses,
            true
        );

        // check bundles
        assert.equal(bundles.length, 1);
        let closing_bundle = bundles[0];

        // check transactions in bundle
        let oneTransaction = closing_bundle.find(t => t.address === ONE_SETTLEMENT);
        assert.equal(oneTransaction.value, 800);

        let twoTransaction = closing_bundle.find(t => t.address === TWO_SETTLEMENT);
        assert.equal(twoTransaction.value, 1200);

        let rootTransactions = closing_bundle.filter(t => t.address === oneFlash.flash.root.address);
        assert.equal(rootTransactions.length, 4);
        let rootValueTransaction = rootTransactions.find(t => Math.abs(t.value) > 0);
        assert.equal(rootValueTransaction.value, -2000);
    });
});
