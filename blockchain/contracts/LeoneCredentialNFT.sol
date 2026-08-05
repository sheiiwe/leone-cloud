// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Leone Consulting Credential NFT
/// @notice NFT nominativo e non trasferibile (soulbound) che ancora la prova
///         di un certificato Open Badge senza pubblicare dati personali on-chain.
contract LeoneCredentialNFT is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes4 private constant _INTERFACE_ID_ERC5192 = 0xb45a3c0e;

    uint256 private _nextTokenId = 1;

    mapping(uint256 tokenId => bytes32 commitment) public credentialCommitment;
    mapping(bytes32 commitment => bool used) public commitmentUsed;
    mapping(bytes32 commitment => uint256 tokenId) public tokenIdForCommitment;
    mapping(uint256 tokenId => bool revoked) public revoked;
    mapping(uint256 tokenId => bytes32 reasonHash) public revocationReasonHash;

    event Locked(uint256 tokenId);
    event CredentialMinted(uint256 indexed tokenId, bytes32 indexed commitment, address indexed custodian);
    event CredentialRevoked(uint256 indexed tokenId, bytes32 indexed reasonHash);

    error NonTransferable();
    error InvalidCommitment();
    error CommitmentAlreadyUsed();

    constructor(address admin, address minter)
        ERC721("Leone Consulting Credential", "LCBADGE")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
    }

    function mintCredential(address custodian, bytes32 commitment, string calldata metadataUri)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitmentUsed[commitment]) revert CommitmentAlreadyUsed();

        tokenId = _nextTokenId++;
        credentialCommitment[tokenId] = commitment;
        commitmentUsed[commitment] = true;
        tokenIdForCommitment[commitment] = tokenId;
        _safeMint(custodian, tokenId);
        _setTokenURI(tokenId, metadataUri);

        emit Locked(tokenId);
        emit CredentialMinted(tokenId, commitment, custodian);
    }

    function revokeCredential(uint256 tokenId, bytes32 reasonHash)
        external
        onlyRole(MINTER_ROLE)
    {
        ownerOf(tokenId);
        revoked[tokenId] = true;
        revocationReasonHash[tokenId] = reasonHash;
        emit CredentialRevoked(tokenId, reasonHash);
    }

    /// @dev EIP-5192: ogni token emesso da questo contratto è sempre bloccato.
    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    /// @dev Blocca transfer e safeTransfer. Il mint resta consentito.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert NonTransferable();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return interfaceId == _INTERFACE_ID_ERC5192 || super.supportsInterface(interfaceId);
    }
}
